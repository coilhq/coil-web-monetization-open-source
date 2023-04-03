// A `jest --filter` script. See:
//   https://github.com/facebook/jest/blob/0d1c09cc546a575b5acd0ecc3f7bfe5262569e12/e2e/filter/my-filter.js
// for an example. It excludes the 'addSecondsToUsage' test when no
// redis-server is available.

const IORedis = require('ioredis')

module.exports = async function (tests) {
  const filtered = []
  for (let i = 0; i < tests.length; i++) {
    if (tests[i].includes('addSecondsToUsage')) {
      if (!await isRedisConnected()) continue
    }
    filtered.push({ test: tests[i] })
  }
  return { filtered }
}

function isRedisConnected () {
  const redis = new IORedis()
  return new Promise((resolve, reject) => {
    redis.get('test').then(() => resolve(true))
    redis.on('error', () => resolve(false))
  })
}
