/* eslint-disable no-unmodified-loop-condition */

const MAX_BLOCK_RELOAD = 15
const MAX_BLOCK_RETRY = 5

module.exports = function tailBlocks (web3, since, confirmations, onblock, onfork) {
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

  async function getBlock (seq, bad) {
    let error = null

    for (let i = 0; i < MAX_BLOCK_RELOAD; i++) {
      try {
        const blk = await web3.eth.getBlock(seq, true)
        const fork = !!(bad && blk.hash === bad.hash)
        if (i >= (MAX_BLOCK_RELOAD - 1) || !fork) return blk
        if (fork && !stopped) await onfork(seq, blk, bad)
      } catch (err) {
        error = err
      }

      if (stopped) return null
      await sleep(1000)
      if (stopped) return null
    }

    throw (error || new Error('Could not load block ' + seq))
  }

  async function run () {
    let retries = 0
    let bad = null
    let blk

    while (!stopped) {
      const c = await confirmed(since)
      if (c < 0) return

      try {
        blk = await getBlock(since++, bad)
        if (stopped) return
        await onblock(blk, c)
      } catch (err) {
        if (retries++ >= MAX_BLOCK_RETRY) throw err
        bad = blk
        since--
        await sleep(100)
      }
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
