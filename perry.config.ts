/**
 * Perry compiler configuration for @perry/postgres.
 *
 * Pure-TypeScript Postgres wire-protocol driver. No native Rust crate,
 * no FFI declarations — all capabilities come from perry-stdlib
 * (`net.Socket`, `tls.connect`, `socket.upgradeToTLS`, `crypto.*`, `Buffer`).
 */
export default {
  name: '@perry/postgres',
  version: '0.2.0',
  entry: 'src/index.ts',
  perry: '0.5.20',
};
