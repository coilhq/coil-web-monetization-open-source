addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

const SAFE_HEADERS = [
  'host',
  'content-type',
  'content-length',
  'accept-encoding'
]

/**
 * Strip headers that could fingerprint the visitor
 * @param {Request} request
 */
async function handleRequest (request) {
  const safeHeaders = new Headers()

  for (const header of SAFE_HEADERS) {
    if (request.headers.get(header)) {
      safeHeaders.append(header, request.headers.get(header))
    }
  }

  // TODO: will we ever need other types?
  safeHeaders.append('accept', 'application/json')

  return fetch(new Request(request, { headers: safeHeaders }))
}
