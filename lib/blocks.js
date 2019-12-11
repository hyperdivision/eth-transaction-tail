module.exports = async function tailBlocks (web3, since, confirmations, onblock) {
  let stopped = false

  const promise = new Promise((resolve, reject) => {
    run().then(resolve).catch(reject)
  })

  return {
    promise,
    stop
  }

  function stop () {
    stopped = true
  }

  async function run () {
    while (!stopped) {
      const c = await confirmed(since)
      if (c < 0) return
      await onblock(await web3.eth.getBlock(since++, true), c)
    }
  }

  async function confirmed (next) {
    while (!stopped) {
      const height = await web3.eth.getBlockNumber()

      if (next >= (height - confirmations)) {
        await sleep(1000)
        continue
      }

      return height - next
    }

    return -1
  }
}

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
