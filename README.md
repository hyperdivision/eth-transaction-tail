# eth-transaction-tail

Tails transactions on the Ethereum blockchain

```
npm install @hyperdivision/eth-transaction-tail
```

## Usage

``` js
const Tail = require('eth-transaction-tail')

const tail = new Tail(ipcUrl, {
  confirmations: 10, // require this many confirmations
  depositFactory: '0x...',
  async depositDeployed (event) {
    // deposit is deployed
  },
  async filter (toAddr, erc20address) {
    return isInterestingAddress(toAddr)
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
  since: seq
})

// tail.index is the current block index
await tail.start() // start tailing, will throw if an error is hit

const head = await tail.head({
  transaction (transaction) {
    console.log('transaction with 0 confirms', transaction)
  }
})

await head.start()

// only track txs on a specific addr
head.track(addr, function ontx (tx, confirms, blk) {
  ...
  head.untrack(addr) // to stop
})
```
