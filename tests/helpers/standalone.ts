export function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

export function decodeBase64Text(encoded: string): string {
  const bytes = Uint8Array.from(
    atob(encoded),
    character => character.charCodeAt(0),
  )

  return new TextDecoder().decode(bytes)
}

export function artifactFromDocument(doc: Document): unknown {
  const elements = doc.querySelectorAll('#genui-artifact')

  if (elements.length !== 1) {
    throw new Error(`expected one #genui-artifact, found ${elements.length}`)
  }

  return JSON.parse(
    decodeBase64Text(elements[0].textContent?.trim() ?? ''),
  )
}

export function bundleNames(doc: Document): string[] {
  const names = Array.from(
    doc.querySelectorAll<HTMLScriptElement>(
      'script[data-genui-bundle]',
    ),
  ).map(element => element.dataset.genuiBundle ?? '')

  if (new Set(names).size !== names.length) {
    throw new Error('duplicate standalone bundle')
  }

  return names
}

export function bundleText(doc: Document, name: string): string {
  const elements = Array.from(
    doc.querySelectorAll<HTMLScriptElement>(
      'script[data-genui-bundle]',
    ),
  ).filter(candidate => candidate.dataset.genuiBundle === name)

  if (elements.length !== 1) {
    throw new Error(`expected one standalone bundle ${name}, found ${elements.length}`)
  }

  return decodeBase64Text(elements[0].textContent?.trim() ?? '')
}

export function cspFromDocument(
  doc: Document,
): Record<string, string[]> {
  const content = doc
    .querySelector('meta[http-equiv="Content-Security-Policy"]')
    ?.getAttribute('content')

  if (content === null || content === undefined) {
    throw new Error('missing CSP')
  }

  return Object.fromEntries(
    content
      .split(';')
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const [directive, ...values] = part.split(/\s+/)
        return [directive!, values]
      }),
  )
}

export function parseCssVariables(
  css: string,
  selector: string,
): Record<string, string> {
  const rules = Array.from(
    css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g),
  ).filter(([, ruleSelector]) => ruleSelector.trim() === selector)

  if (rules.length === 0) {
    throw new Error(`missing CSS rule: ${selector}`)
  }

  const declarations: Record<string, string> = {}

  for (const [, , body] of rules) {
    for (const [, name, value] of body.matchAll(/(--[\w-]+|color-scheme)\s*:\s*([^;]+);/g)) {
      declarations[name] = value.trim()
    }
  }

  return declarations
}

export function pickTokens(declarations: Record<string, string>, keys: string[]): Record<string, string> {
  for (const key of keys) {
    if (!(key in declarations)) {
      throw new Error(`missing CSS token: ${key}`)
    }
  }

  return Object.fromEntries(keys.map(key => [key, declarations[key]]))
}
