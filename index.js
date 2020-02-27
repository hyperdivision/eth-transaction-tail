const tailBlocks = require('./lib/blocks')
const Web3 = require('web3')
const hashlru = require('hashlru')
const events = require('./lib/events')

const TO = Symbol('to address')
const FROM = Symbol('from address')

module.exports = class Tail {
  constructor (wsUrl, opts = {}) {
    this.erc20 = opts.erc20 !== false
    this.deployCache = makeCache(opts.deployCache)
    this.depositFactory = opts.depositFactory
    this.web3 = opts.web3 || new Web3(new Web3.providers.WebsocketProvider(wsUrl))
    this.confirmations = typeof opts.confirmations === 'number' ? opts.confirmations : 12
    this.filter = opts.filter || (() => true)
    this.ondepositdeployed = opts.depositDeployed || (() => {})
    this.ondeposit = opts.deposit || (() => {})
    this.ontransaction = opts.transaction || (() => {})
    this.oncheckpoint = opts.checkpoint || (() => {})
    this.onerc20 = opts.erc20 || (() => {})
    this.onblock = opts.block || (() => {})
    this.since = opts.since || 0
    this.minSince = opts.minSince || 0
    this.stopped = false
    this.running = null
    this.topics = [events.DEPOSIT_FACTORY_DEPLOYED.id, events.DEPOSIT_FORWARDED.id].concat(this.erc20 ? events.ERC20_TRANSFER.id : [])
    this.limit = 2

    if (opts.isDepositDeployed) this.isDepositDeployed = opts.isDepositDeployed
  }

  static TO = TO
  static FROM = FROM

  async start (since = this.since) {
    if (this.running) throw new Error('Already started')

    if (since === 'now' || since === 'latest') {
      since = this.since = Math.max(this.minSince, await this.web3.eth.getBlockNumber())
    }

    const status = tailBlocks(this.web3, since, this.confirmations, this._onblock.bind(this))
    const cleanup = () => { this.running = null }
    this.stopped = false
    this.running = status
    status.promise.then(cleanup).catch(cleanup)
    await status.promise
  }

  stop () {
    if (!this.running) return Promise.resolve()
    this.stopped = true
    this.running.stop()
    return this.running.promise
  }

  head (opts) {
    return new Tail(null, {
      web3: this.web3,
      deployCache: false,
      confirmations: 0,
      since: 'now',
      minSince: typeof this.since === 'number' ? this.since + this.confirmations : 0,
      depositFactory: this.depositFactory,
      filter: this.filter,
      ...opts
    })
  }

  isDepositDeployedCached (addr, blockNumber, txIndex) {
    if (this.deployCache) {
      const deployed = this.deployCache.get(addr.toLowerCase())
      if (deployed === false) return false
      if (deployed === true) return true
    }
    return this.isDepositDeployed(addr, blockNumber, txIndex)
  }

  isDepositDeployed (addr, blockNumber) {
    return this.isDepositDeployedFromChain(addr, blockNumber)
  }

  async isDepositDeployedFromChain (addr, blockNumber) {
    let tries = 10
    while (true) {
      try {
        const code = await this.web3.eth.getCode(addr, blockNumber - 1)
        return code !== '0x'
      } catch (err) {
        if (--tries > 0) continue
        throw err
      }
    }
  }

  onlog (log, e, tx, blk, confirmations, deployStatus) {
    const blockNumber = blk.number
    const transactionIndex = tx.transactionIndex
    const logIndex = log.logIndex
    const transactionHash = tx.hash

    if (e.name === 'DEPOSIT_FACTORY_DEPLOYED' && eq(log.address, this.depositFactory)) {
      deployStatus.set(e.contractAddress.toLowerCase(), Promise.resolve(true))
      return this.ondepositdeployed({ contractAddress: e.contractAddress, transactionHash, blockNumber, transactionIndex, logIndex }, confirmations, tx, blk, log)
    }

    if (e.name === 'DEPOSIT_FORWARDED') {
      return this.ondeposit({ from: log.address, to: e.to, amount: e.amount, transactionHash, blockNumber, transactionIndex, logIndex }, confirmations, tx, blk, log)
    }

    if (e.name === 'ERC20_TRANSFER') {
      return this.onerc20({ from: e.from, to: e.to, amount: e.amount, token: log.address, transactionHash, blockNumber, transactionIndex, logIndex }, confirmations, tx, blk, log)
    }
  }

  async _onblock (blk, confirmations) {
    await this.onblock(blk)

    const logs = (await this.web3.eth.getPastLogs({
      fromBlock: blk.number,
      toBlock: blk.number,
      topics: [this.topics]
    })).sort(sortLogs)

    const queue = []
    const deployStatus = new Map()

    if (this.stopped) return all()

    let l = 0
    let parallel = 0

    for (let i = 0; i < blk.transactions.length; i++) {
      const tx = blk.transactions[i]

      while (l < logs.length && logs[l].transactionIndex === i) {
        const log = logs[l++]
        const e = events.decode(log)
        if (!e) continue

        if (e.name === 'ERC20_TRANSFER') {
          if (!(await this.filter(e.to, TO, log.address)) && !(await this.filter(e.from, FROM, log.address))) {
            continue
          }
        }
        if (e.name === 'DEPOSIT_FACTORY_DEPLOYED' && !eq(log.address, this.depositFactory)) {
          continue
        }

        // TODO: shortcircuit the DEPOSIT_FORWARDED event also here for more speed

        const receipt = this.web3.eth.getTransactionReceipt(tx.hash)
        if (++parallel > this.limit) await receipt

        queue.push({
          tx,
          checkDeployed: false,
          receipt,
          op: () => this.onlog(log, e, tx, blk, confirmations, deployStatus)
        })
      }

      if (this.stopped) return all()
      if (!(await this.filter(tx.to, TO, null)) && !(await this.filter(tx.from, FROM, null))) continue
      if (this.stopped) return all()

      if (tx.to && !deployStatus.has(tx.to.toLowerCase())) {
        const p = this.isDepositDeployedCached(tx.to, blk.number, i)
        deployStatus.set(tx.to.toLowerCase(), p)
        if (++parallel > this.limit) await p
      }

      const receipt = this.web3.eth.getTransactionReceipt(tx.hash)
      if (++parallel > this.limit) await receipt

      queue.push({
        tx,
        checkDeployed: !!tx.to,
        receipt,
        op: () => this.ontransaction(tx, confirmations, blk)
      })
    }

    for (const { tx, checkDeployed, receipt, op } of queue) {
      if (checkDeployed && await deployStatus.get(tx.to.toLowerCase())) continue
      if (!(await receipt).status) continue
      await op()
      if (this.limit < 64) this.limit++
    }

    if (this.deployCache) {
      for (const [k, v] of deployStatus) {
        this.deployCache.set(k, await v)
      }
    }

    await this.oncheckpoint(blk.number + 1, confirmations, blk)

    async function all () {
      for (const { receipt } of queue) await receipt
      for (const v of deployStatus.values()) await v
    }
  }
}

function sortLogs (a, b) {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber
  if (a.transactionIndex !== b.transactionIndex) return a.transactionIndex - b.transactionIndex
  return a.logIndex - b.logIndex
}

function eq (a, b) {
  if (!a || !b) return false
  return a.toLowerCase() === b.toLowerCase()
}

function makeCache (size) {
  if (size === false || size === 0) return null
  if (size && typeof size !== 'number') return size
  return hashlru(typeof size === 'number' ? size : 1024)
}
