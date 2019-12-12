const blocks = require('./blocks')

const IN = Symbol('in')
const OUT = Symbol('out')

transactions.IN = IN
transactions.OUT = OUT

module.exports = transactions

async function transactions (web3, since, confirmations, filter, ontx, onnext) {
  let stopped = false
  const { stop, promise } = blocks(web3, since, confirmations, onblock)

  return {
    promise,
    stop: stopTx
  }

  async function onblock (block, confirmations) {
    for (const tx of block.transactions) {
      if (await filter(tx.from, IN) || await filter(tx.to, OUT)) {
        if (stopped) return
        const succeeded = (await web3.eth.getTransactionReceipt(tx.hash)).status
        if (stopped) return
        await ontx({ tx, confirmations, succeeded })
        if (stopped) return
      }
    }
    if (onnext) await onnext(block)
  }

  function stopTx () {
    stopped = true
    stop()
  }
}
