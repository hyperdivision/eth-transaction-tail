const tailBlocks = require('./lib/blocks')
const tailTransactions = require('./lib/transactions')
const EventTail = require('@hyperdivision/eth-event-tail')

const DepositABI = require('./abi/Deposit.json')
const ERC20ABI = require('./abi/erc20.json')
const Web3 = require('web3')

class ETHTail {
  constructor (wsUrl, opts = {}) {
    this.web3 = new Web3(new Web3.providers.WebsocketProvider(wsUrl))
    this.events = null
    this.tx = null
    this.since = opts.since || 0
    this.confirmations = opts.confirmations || 0
    this.filter = opts.filter || (() => true)
    this.transaction = opts.transaction || (() => {})
    this.event = opts.event || (() => {})
    this.checkpoint = opts.checkpoint || (() => {})
    this.erc20 = opts.erc20 || []
    this.running = []
  }

  async start (since) {
    const self = this

    if (since !== undefined) this.since = since

    this.running.push(new EventTail(this.web3, {
      name: 'DepositForwarded',
      abi: DepositABI,
      since: this.since,
      confirmations: this.confirmations,
      event: onevent
    }))

    const erc20 = this.erc20.map(addr => {
      return new EventTail(this.web3, {
        name: 'Transfer',
        abi: ERC20ABI,
        address: addr,
        since: this.since,
        confirmations: this.confirmations,
        event: onevent
      })

      async function onevent (data, confirmations) {
        if (!(await self.filter(data.returnValues.to, tailTransactions.OUT))) return

        const normalised = {
          type: 'event',
          name: 'ERC20Transfer',
          blockNumber: data.blockNumber,
          blockHash: data.blockHash,
          confirmations,
          transactionIndex: data.transactionIndex,
          transactionHash: data.transactionHash,
          address: data.returnValues.to,
          amount: data.returnValues.value
        }

        await self.event(normalised)
      }
    })

    this.running.push(tailTransactions(this.web3, this.since, this.confirmations, this.filter, ontx, oncheckpoint))

    try {
      await Promise.all(this.running.map(e => e.promise))
    } catch (err) {
      for (const e of this.running) e.stop()
      throw err
    }

    async function oncheckpoint (block) {
      const since = block.blockNumber + 1
      await self.checkpoint(since)
    }

    async function onevent (data, n) {
      if (!(await self.filter(data.returnValues.from, tailTransactions.OUT))) return

      const normalised = {
        type: 'event',
        name: 'DepositForwarded',
        blockNumber: data.blockNumber,
        blockHash: data.blockHash,
        confirmations: n,
        transactionIndex: data.transactionIndex,
        transactionHash: data.transactionHash,
        address: data.returnValues.from,
        amount: data.returnValues.amount
      }

      await self.event(normalised)
    }

    async function ontx (data) {
      if (!data.tx.to) return

      if (await self.web3.eth.getCode(data.tx.to, data.tx.blockNumber) !== '0x') {
        return
      }

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

const tail = new ETHTail('ws://127.0.0.1:8545', {
  erc20: [
    '0x4e2bc1229A77a774C2e56C3dD71E40ACdB499E3f'
  ],
  event (e) {
    console.log(e)
  },
  transaction (tx) {
    console.log(tx)
  }
})

tail.start(0).then(() => console.log('done')).catch(err => console.error('nej', err))

// const q = new EventTail(tail.web3, {
//   abi: require('./abi/ERC20.json'),
//   name: 'Transfer',
//   // address: '0x4e2bc1229A77a774C2e56C3dD71E40ACdB499E3f',
//   confirmations: 0,
//   async event (data, confirmations) {
//     console.log('-->', data, confirmations)
//   },
//   async checkpoint (since) {
//     console.log('checkpoint', since)
//   }
// })
