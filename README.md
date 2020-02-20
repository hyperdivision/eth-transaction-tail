# eth-transaction-tail

Tails transactions on the Ethereum blockchain

```
npm install @hyperdivision/eth-transaction-tail
```

## Usage

``` js
const Tail = require('eth-transaction-tail')

const tail = new Tail(rpcUrl, {
  confirmations: 10, // require this many confirmations
  depositFactory: '0x...',
  async isDepositDeployed (addr, blockNumber, txIndex) {
    // optional! return true if deposit contract is deployed at this addr
    // if not provided, internally the indexed event is used
    return true // or false
  },
  async depositDeployed (event) {
    // deposit is deployed
  },
  async filter (addr, type, erc20address) {
    return isInterestingAddress(addr)
  },
  async transaction (transaction) {
    console.log('found this transaction', transaction)
  },
  async deposit (event) {
    console.log('found this deposit event')
  },
  async erc20 (event) {
    console.log('found this erc20 transfer event')
  }
  async checkpoint (since) {
    // store this since so you can restart from here
  },
  since: 'now' // or a seq
})

// tail.index is the current block index
await tail.start() // start tailing, will throw if an error is hit

const head = tail.head({
  transaction (transaction) {
    console.log('transaction with 0 confirms', transaction)
  }
})

await head.start()
```
