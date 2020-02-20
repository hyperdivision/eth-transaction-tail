const tailBlocks = require('./lib/blocks')
const Web3 = require('web3')
const events = require('./lib/events')

const TO = Symbol('to address')
const FROM = Symbol('from address')

module.exports = class Tail {
  constructor (wsUrl, opts = {}) {
    this.erc20 = opts.erc20 !== false
    this.depositFactory = opts.depositFactory
    this.web3 = opts.web3 || new Web3(new Web3.providers.WebsocketProvider(wsUrl))
    this.confirmations = 0
    this.filter = opts.filter || (() => true)
    this.ondepositdeployed = opts.depositDeployed || (() => {})
    this.ondeposit = opts.deposit || (() => {})
    this.ontransaction = opts.transaction || (() => {})
    this.oncheckpoint = opts.checkpoint || (() => {})
    this.onerc20 = opts.erc20 || (() => {})
    this.since = opts.since || 0
    this.stopped = false
    this.running = null
    this.topics = [events.DEPOSIT_FACTORY_DEPLOYED.id, events.DEPOSIT_FORWARDED.id].concat(this.erc20 ? events.ERC20_TRANSFER.id : [])

    if (opts.isDepositDeployed) this.isDepositDeployed = opts.isDepositDeployed
  }

  static TO = TO
  static FROM = FROM

  async start (since = this.since) {
    if (this.running) throw new Error('Already started')

    if (since === 'now' || since === 'latest') {
      since = this.since = await this.web3.eth.getBlockNumber()
    }

    const status = tailBlocks(this.web3, since, this.confirmations, this.onblock.bind(this))
    const cleanup = () => { this.running = null }
    this.stopped = false
    this.running = status
    status.promise.then(cleanup).catch(cleanup)
    await status.promise
  }

  stop () {
    if (!this.running) return
    this.stopped = true
    return this.running.promise
  }

  head (opts) {
    return new Tail(null, {
      web3: this.web3,
      confirmations: 0,
      since: 'now',
      depositFactory: this.depositFactory,
      filter: this.filter,
      ...opts
    })
  }

  async isDepositDeployed (addr, blockNumber, txIndex) {
    const logs = await this.web3.eth.getPastLogs({
      fromBlock: 0,
      toBlock: blockNumber,
      address: this.depositFactory,
      topics: events.DEPOSIT_FACTORY_DEPLOYED.encode(addr)
    })

    for (const log of logs) {
      if (log.transactionIndex <= txIndex) return true
    }

    return false
  }

  onlog (log, e, tx, blk, confirmations) {
    const blockNumber = blk.number
    const transactionIndex = tx.transactionIndex
    const logIndex = log.logIndex
    const transactionHash = tx.hash

    if (e.name === 'DEPOSIT_FACTORY_DEPLOYED' && eq(log.address, this.depositFactory)) {
      return this.ondepositdeployed({ contractAddress: e.contractAddress, transactionHash, blockNumber, transactionIndex, logIndex }, confirmations, tx, blk, log)
    }

    if (e.name === 'DEPOSIT_FORWARDED') {
      return this.ondeposit({ from: log.address, to: e.to, amount: e.amount, transactionHash, blockNumber, transactionIndex, logIndex }, confirmations, tx, blk, log)
    }

    if (e.name === 'ERC20_TRANSFER') {
      return this.onerc20({ from: e.from, to: e.to, amount: e.amount, token: log.address, transactionHash, blockNumber, transactionIndex, logIndex }, confirmations, tx, blk, log)
    }
  }

  async onblock (blk, confirmations) {
    const logs = (await this.web3.eth.getPastLogs({
      fromBlock: blk.number,
      toBlock: blk.number,
      topics: [this.topics]
    })).sort(sortLogs)

    if (this.stopped) return

    let l = 0

    for (let i = 0; i < blk.transactions.length; i++) {
      const tx = blk.transactions[i]
      let receipt

      while (l < logs.length && logs[l].transactionIndex === i) {
        const log = logs[l++]
        const e = events.decode(log)
        if (!e) continue

        if (e.name === 'ERC20_TRANSFER') {
          if (!(await this.filter(e.to, TO, log.address)) && !(await this.filter(e.from, FROM, log.address))) {
            continue
          }
        }

        if (!receipt) receipt = await this.web3.eth.getTransactionReceipt(tx.hash)
        if (!receipt.status) continue

        await this.onlog(log, e, tx, blk, confirmations)
        if (this.stopped) return
      }
      if (this.stopped) return

      if (!(await this.filter(tx.to, TO, null)) && !(await this.filter(tx.from, FROM, null))) continue
      if (this.stopped) return

      if (tx.to && await this.isDepositDeployed(tx.to, blk.number, i)) continue

      if (!receipt) receipt = await this.web3.eth.getTransactionReceipt(tx.hash)
      if (!receipt.status) continue

      await this.ontransaction(tx, confirmations, blk)
      if (this.stopped) return
    }

    await this.oncheckpoint(blk.number + 1, confirmations, blk)
    if (this.stopped) return
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
