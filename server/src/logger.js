/** Tiny timestamped logger (keeps the dependency list short). */
const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19)

const write = (level, args) => {
  const line = `[${stamp()}] ${level}`
  if (level === 'ERROR') console.error(line, ...args)
  else if (level === 'WARN') console.warn(line, ...args)
  else console.log(line, ...args)
}

export const log = {
  info: (...args) => write('INFO ', args),
  warn: (...args) => write('WARN ', args),
  error: (...args) => write('ERROR', args),
  debug: (...args) => {
    if (process.env.WA_DEBUG === 'true') write('DEBUG', args)
  },
}
