// The request contract every mutating route holds its callers to, shared so the
// client that sends it and the server guard that checks it cannot drift apart.
//
// A mutating route changes a real repository on the user's disk, and the
// service answers on loopback without authentication. Loopback keeps other
// machines out; it does not keep out *other web pages in the user's own
// browser*, which can fire requests at 127.0.0.1 too. Browsers let a foreign
// page send a "simple" cross-origin POST (form-encoded or text/plain, no custom
// headers) without asking the server first — that is the whole of classic
// CSRF. Requiring a custom header and a JSON body takes the request out of that
// class: a cross-origin page can only send it after a CORS preflight, and this
// service answers no preflight, so the browser never sends the request at all.

/** Header every mutating request must carry, with {@link MUTATION_REQUEST_HEADER_VALUE}. */
export const MUTATION_REQUEST_HEADER = 'x-git-graph-action'

/** The value of {@link MUTATION_REQUEST_HEADER}; any other value is refused. */
export const MUTATION_REQUEST_HEADER_VALUE = '1'
