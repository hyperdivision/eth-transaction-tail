const BlockQueue = require('./lib/queue')
const NanoETH = require('nanoeth/ipc')
const events = require('./lib/events')

module.exports = class Tail {
  constructor (ipc, opts) {
    this.erc20 = opts.erc20 !== false
    this.depositFactory = [].concat(opts.depositFactory || [])
    this.started = null
    this.filter = opts.filter || noop
    this.ontransaction = opts.transaction || noop
    this.ondepositdeployed = opts.depositDeployed || noop
    this.ondeposit = opts.deposit || noop
    this.oncheckpoint = opts.checkpoint || noop
    this.onblock = opts.block || noop
    this.ids = [
      events.DEPOSIT_FACTORY_DEPLOYED.id,
      events.DEPOSIT_FORWARDED.id
    ].concat(this.erc20 ? events.ERC20_TRANSFER.id : [])

    this.eth = opts.eth || new NanoETH(ipc)
    this.queue = new BlockQueue(this.eth, {
      ...opts,
      get: this.get.bind(this)
    })

    this.getBlockByNumber = this._retry((seq, tx) => this.eth.getBlockByNumber(seq, tx))
    this.getLogs = this._retry((opts) => this.eth.getLogs(opts))
    this.getTransactionReceipt = this._retry((hash) => this.eth.getTransactionReceipt(hash))
  }

  get since () {
    return this.queue.tail
  }

  get blockHeight () {
    return this.queue.blockHeight
  }

  async head (opts) {
    const now = await this.now()
    const min = this.queue.tail + this.queue.confirmations

    return new Tail(null, {
      eth: this.eth,
      depositFactory: this.depositFactory,
      filter: this.filter,
      erc20: this.erc20,
      since: Math.max(min, now),
      confirmations: 0,
      ...opts
    })
  }

  async now () {
    let prev = null

    while (true) {
      const height = await this.eth.blockNumber()
      if (height === prev) {
        await this.queue.blocking.wait(500)
        continue
      }

      prev = height

      const { timestamp, number } = await this.eth.getBlockByNumber(height)
      const ms = Number(timestamp) * 1000
      if (ms >= Date.now() || (Date.now() - ms) < 10000) return Number(number)
      const delta = (Date.now() - ms) - 60000
      await this.queue.blocking.wait(Math.max(500, delta))
    }
  }

  async get (seq) {
    const [block, logs] = await Promise.all([
      this.getBlockByNumber(hex(seq), true),
      this.getLogs({ fromBlock: hex(seq), toBlock: hex(seq), topics: [this.ids] })
    ])

    const queue = []
    const isContract = new Set()

    let l = 0

    for (let i = 0; i < block.transactions.length; i++) {
      const tx = block.transactions[i]

      let receipt = null
      let prev = -1

      while (l < logs.length && Number(logs[l].transactionIndex) === i) {
        const log = logs[l++]

        // Couldn't see the ordering mentioned in the logs,
        // but everything seems to be ordered, so lets just assert that also
        const logIndex = Number(log.logIndex)
        if (logIndex <= prev) throw new Error('Invalid log order')
        prev = logIndex

        const e = events.decode(log)
        if (!e) continue

        const addr = log.address

        if (e.name === 'ERC20_TRANSFER') {
          if (!(await this.filter(e.to, addr))) continue
        }

        if (e.name === 'DEPOSIT_FORWARDED') {
          if (!(await this.filter(addr, addr))) continue
        }

        if (e.name === 'DEPOSIT_FACTORY_DEPLOYED') {
          if (!eqList(addr, this.depositFactory)) continue
        }

        isContract.add(addr)
        if (!receipt) receipt = this.getTransactionReceipt(tx.hash)
        queue.push({ receipt, status: false, tx, log, event: e })
      }

      if (isContract.has(tx.to)) continue
      if (!(await this.filter(tx.to, null))) continue

      if (!receipt) receipt = this.getTransactionReceipt(tx.hash)
      queue.push({ receipt, status: false, tx, log: null, event: null })
    }

    await Promise.all(queue.map(async (q) => {
      q.status = (await q.receipt).status === '0x1'
    }))

    return { block, queue }
  }

  start () {
    if (this.started) return this.started

    this.started = Promise.all([
      this.queue.start(),
      this.loop()
    ])

    return this.started
  }

  stop (gracefully = false) {
    if (gracefully) this.eth.end()
    else this.eth.destroy()
    return this.queue.destroy()
  }

  _retry (fn) {
    const eth = this.eth

    return async function (...args) {
      let error = null

      for (let i = 0; i < 30; i++) {
        if (i) await this.queue.blocking.wait(1000)

        try {
          return await fn(...args)
        } catch (err) {
          error = err
        }

        if (eth.destroyed) break
      }

      throw error
    }
  }

  async loop () {
    while (!this.queue.destroyed) {
      const { block, queue } = await this.queue.shift()

      const blockNumber = Number(block.number)
      const confirmations = this.queue.blockHeight - blockNumber

      await this.onblock(block, confirmations)

      for (const { status, tx, log, event } of queue) {
        if (!status) continue
        if (event) {
          if (event.name === 'DEPOSIT_FACTORY_DEPLOYED') {
            await this.ondepositdeployed({ contractAddress: event.contractAddress }, tx, confirmations, block, log)
            continue
          }

          if (event.name === 'DEPOSIT_FORWARDED') {
            await this.ondeposit({ from: log.address, to: event.to, amount: event.amount }, tx, confirmations, block, log)
            continue
          }

          if (event.name === 'ERC20_TRANSFER') {
            await this.onerc20({ from: event.from, to: event.to, amount: event.amount, token: log.address }, tx, confirmations, block, log)
            continue
          }
        } else {
          await this.ontransaction(tx, confirmations, block)
        }
      }

      await this.oncheckpoint(blockNumber + 1)
    }
  }
}

function noop () {
  return true
}

function hex (n) {
  return '0x' + n.toString(16)
}

function eqList (a, list) {
  for (const addr of list) {
    if (eq(a, addr)) return true
  }
  return false
}

function eq (a, b) {
  if (!a || !b) return false
  return a.toLowerCase() === b.toLowerCase()
}
