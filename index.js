const tailTransactions = require('./lib/transactions')
const EventTail = require('@hyperdivision/eth-event-tail')

const DepositABI = require('./abi/Deposit.json')
const ERC20ABI = require('./abi/erc20.json')
const Web3 = require('web3')

class ETHTail {
  constructor (wsUrl, opts = {}) {
    this.web3 = opts.web3 || new Web3(new Web3.providers.WebsocketProvider(wsUrl))
    this.tx = null
    this.since = opts.since || { tx: 0, deposits: 0, erc20: {} }
    this.confirmations = opts.confirmations || 0
    this.filter = opts.filter || (() => true)
    this.transaction = opts.transaction || (() => {})
    this.event = opts.event || (() => {})
    this.checkpoint = opts.checkpoint || (() => {})
    this.block = opts.block || (() => {})
    this.erc20 = opts.erc20 || []
    this.running = []
    this.events = opts.events !== false
  }

  head (opts = {}) {
    return new ETHTail(null, {
      web3: this.web3,
      confirmations: 0,
      since: 'latest',
      filter: this.filter,
      events: this.events,
      ...opts
    })
  }

  async start (since) {
    const self = this

    if (since !== undefined) this.since = since
    if (this.since === 'now' || this.since === 'latest') {
      const n = await this.web3.eth.getBlockNumber()
      const erc20 = {}
      for (const addr of this.erc20) erc20[addr] = n
      this.since = { tx: n, deposits: n, erc20 }
    }

    if (this.events) {
      this.running.push(new EventTail(this.web3, {
        name: 'DepositForwarded',
        abi: DepositABI,
        since: this.since.deposits || 0,
        confirmations: this.confirmations,
        event: onevent,
        checkpoint: oneventcheckpoint
      }))
    }

    this.running.push(tailTransactions(this.web3, this.since.tx || 0, this.confirmations, this.filter, this.block.bind(this), ontx, oncheckpoint))

    const erc20 = this.erc20.map(addr => {
      return new EventTail(this.web3, {
        name: 'Transfer',
        abi: ERC20ABI,
        address: addr,
        since: (this.since.erc20 && this.since.erc20[addr]) || 0,
        confirmations: this.confirmations,
        event: onevent,
        checkpoint
      })

      async function checkpoint (since) {
        self.since.erc20[addr] = since
        await self.checkpoint(self.since)
      }

      async function onevent (data, confirmations) {
        if (!(await self.filter(data.returnValues.to, tailTransactions.OUT, 'ERC20'))) {
          if (!(await self.filter(data.returnValues.from, tailTransactions.IN, 'ERC20'))) return
        }

        const normalised = {
          type: 'event',
          name: 'ERC20Transfer',
          contract: data.address,
          blockNumber: data.blockNumber,
          blockHash: data.blockHash,
          confirmations,
          transactionIndex: data.transactionIndex,
          transactionHash: data.transactionHash,
          from: data.returnValues.from,
          to: data.returnValues.to,
          amount: data.returnValues.value
        }

        await self.event(normalised)
      }
    })

    if (erc20.length) {
      this.running.push(...erc20)
    }

    try {
      await Promise.all(this.running.map(e => e.promise))
    } catch (err) {
      for (const e of this.running) {
        e.stop()
      }
      await Promise.allSettled(this.running.map(e => e.promise))
      throw err
    }

    async function oncheckpoint (block) {
      self.since.tx = block.number + 1
      await self.checkpoint(self.since)
    }

    async function oneventcheckpoint (since) {
      self.since.deposits = since
      await self.checkpoint(self.since)
    }

    async function onevent (data, n) {
      if (!(await self.filter(data.address, tailTransactions.IN, 'DepositForwarded'))) {
        if (!(await self.filter(data.returnValues.to, tailTransactions.OUT, 'DepositForwarded'))) return
      }

      const normalised = {
        type: 'event',
        name: 'DepositForwarded',
        contract: data.address,
        blockNumber: data.blockNumber,
        blockHash: data.blockHash,
        confirmations: n,
        transactionIndex: data.transactionIndex,
        transactionHash: data.transactionHash,
        from: data.address,
        to: data.returnValues.to,
        amount: data.returnValues.amount
      }

      await self.event(normalised)
    }

    async function ontx (data) {
      if (!data.tx.to || data.isContract) return

      const normalised = {
        type: 'tx',
        succeeded: data.succeeded,
        blockNumber: data.tx.blockNumber,
        blockHash: data.tx.blockHash,
        confirmations: data.confirmations,
        transactionIndex: data.tx.transactionIndex,
        transactionHash: data.tx.hash,
        from: data.tx.from,
        to: data.tx.to,
        amount: data.tx.value,
        gas: data.tx.gas
      }

      await self.transaction(normalised)
    }
  }

  async stop () {
    for (const e of this.running) e.stop()
    await Promise.allSettled(this.running.map(e => e.promise))
  }
}

ETHTail.IN = tailTransactions.IN
ETHTail.OUT = tailTransactions.OUT

module.exports = ETHTail
