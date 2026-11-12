import assert from 'node:assert/strict'

export function threadTitlePattern(index) {
  assert.ok(index === 0 || index === 1, 'Only fixture threads A/B are allowed')
  return index === 0 ? /^DSH354 thread-A$/u : /^DSH354 thread-B$/u
}

export function nativeThreadTab(parentOwner, page, index) {

  return parentOwner.locator('[role="tab"][data-dockkit-tab]').filter({
    has: page.locator('[data-dockkit-tab-title]').filter({ hasText: threadTitlePattern(index) }),
  })
}
