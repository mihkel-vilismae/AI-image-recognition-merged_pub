export type LogLevel = 'log' | 'warn' | 'error'

function nowIso() {
  return new Date().toISOString()
}

function stringifyPayload(payload: unknown) {
  if (payload == null) return ''
  if (typeof payload === 'string') return payload
  try {
    return JSON.stringify(payload)
  } catch {
    return String(payload)
  }
}

export function createUiLogger(logEl: HTMLElement, errorEl: HTMLElement, scope: string) {
  function append(target: HTMLElement, line: string) {
    target.textContent = `${target.textContent || ''}${line}\n`
  }

  function write(level: LogLevel, stage: string, message: string, payload?: unknown) {
    const suffix = payload == null ? '' : ` ${stringifyPayload(payload)}`
    const line = `[${nowIso()}] [${scope}] [${stage}] ${message}${suffix}`
    if (level === 'error') {
      append(errorEl, line)
      console.error(line)
      return
    }
    if (level === 'warn') {
      append(errorEl, line)
      console.warn(line)
      return
    }
    append(logEl, line)
    console.log(line)
  }

  async function step<T>(stage: string, run: () => Promise<T>): Promise<T> {
    write('log', stage, 'start')
    try {
      const result = await run()
      write('log', stage, 'ok')
      return result
    } catch (error) {
      write('error', stage, 'failed', {
        name: (error as Error)?.name,
        message: (error as Error)?.message,
        raw: String(error),
      })
      throw error
    }
  }

  return {
    log: (stage: string, message: string, payload?: unknown) => write('log', stage, message, payload),
    warn: (stage: string, message: string, payload?: unknown) => write('warn', stage, message, payload),
    error: (stage: string, message: string, payload?: unknown) => write('error', stage, message, payload),
    step,
  }
}
