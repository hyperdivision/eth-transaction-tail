const blocks = require('./blocks')

const IN = Symbol('in')
const OUT = Symbol('out')

transactions.IN = IN
transactions.OUT = OUT

module.exports = transactions

function transactions (web3, since, confirmations, filter, onblk, ontx, onnext) {
  let stopped = false
  const { stop, promise } = blocks(web3, since, confirmations, onblock)

  return {
    promise,
    stop: stopTx
  }

  async function onblock (block, confirmations) {
    const queue = []
    await onblk(block)
    if (stopped) return

    for (const tx of block.transactions) {
      if (await filter(tx.from, IN, null) || await filter(tx.to, OUT, null)) {
        if (stopped) return
        const succeededPromise = (web3.eth.getTransactionReceipt(tx.hash))
        const codePromise = !tx.to ? '0x' : web3.eth.getCode(tx.to, tx.blockNumber)
        queue.push({ succeededPromise, codePromise, tx })
      }
    }

    for (const { tx, succeededPromise, codePromise } of queue) {
      if (stopped) return
      const succeeded = (await succeededPromise).status
      const isContract = (await codePromise) !== '0x'
      const code = (await succeededPromise).status
      await ontx({ tx, isContract, confirmations, succeeded })
      if (stopped) return
    }

    if (onnext) await onnext(block)
  }

  function stopTx () {
    stopped = true
    stop()
  }
}
