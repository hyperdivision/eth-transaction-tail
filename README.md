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
  async filter (addr) {
    return isInterestingAddress(addr)
  },
  async transaction (transaction) {
    console.log('found this transaction', transaction)
  },
  async event (event) {
    console.log('found this deposit or erc20 event')
  },
  async checkpoint (sinceMap) {
    // store this since so you can restart from here
  }
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
