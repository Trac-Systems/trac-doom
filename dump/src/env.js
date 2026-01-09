export function getEnv () {
  if (typeof process !== 'undefined' && process?.env) return process.env
  if (typeof globalThis !== 'undefined' && globalThis?.Pear?.config?.env) return globalThis.Pear.config.env
  return {}
}
