import { expect, test, type Page } from '@playwright/test'

const password = 'Phase1!a'

test('redirects the local web alias and keeps the configured origin on API writes', async ({ page, request, baseURL }) => {
  const configured = new URL('/sign-in?source=local#form', baseURL)
  const alias = new URL(configured)
  alias.hostname = 'localhost'
  await page.goto(alias.href)
  await expect(page).toHaveURL(configured.href)
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()

  const rejected = await request.post('/v1/auth/refresh', {
    headers: { Origin: alias.origin },
    maxRedirects: 0,
  })
  expect(rejected.status()).toBe(403)
  expect(await rejected.json()).toMatchObject({ code: 'invalid_origin' })
  const accepted = await request.post('/v1/auth/refresh', {
    headers: { Origin: configured.origin },
    maxRedirects: 0,
  })
  expect(accepted.status()).toBe(401)
})

test('renews access for browser actions and coordinates a shared session across tabs', async ({ page, context }) => {
  await signUp(page, `renewal-${Date.now()}@example.com`)
  await context.clearCookies({ name: 'rag_access' })
  await page.getByRole('textbox', { name: 'Workspace name' }).fill('Renewed workspace')
  await page.getByRole('button', { name: 'Create workspace' }).click()
  await expect(page.getByRole('heading', { name: 'Renewed workspace' })).toBeVisible()

  const other = await context.newPage()
  let rotations = 0
  context.on('response', response => {
    if (new URL(response.url()).pathname === '/v1/auth/refresh' && response.status() === 204) rotations += 1
  })
  await context.clearCookies({ name: 'rag_access' })
  await Promise.all([page.goto('/workspaces'), other.goto('/account')])
  await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible()
  await expect(other.getByRole('heading', { name: 'Account', exact: true })).toBeVisible()
  expect(rotations).toBe(1)

  await context.clearCookies()
  await page.goto('/workspaces')
  await expect(page).toHaveURL(/\/sign-in$/)
})

test('registration validates each password requirement', async ({ page }) => {
  await page.goto('/register')
  const field = page.getByLabel('Password', { exact: true })
  for (const invalid of ['Phase1!', 'phase1!a', 'Phase!!a', 'Phase11a', 'Phase1 a']) {
    await field.fill(invalid)
    expect(await field.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(false)
  }
  await field.fill(password)
  expect(await field.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(true)
})

async function signUp(page: Page, email: string) {
  await page.goto('/register')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await expect(page).toHaveURL(/\/sign-in$/)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Workspaces' })).toBeVisible()
}

async function userId(page: Page) {
  await page.getByRole('link', { name: 'Account', exact: true }).click()
  const input = page.getByRole('textbox', { name: 'User ID' })
  await expect(input).toBeVisible()
  return input.inputValue()
}

async function grant(page: Page, id: string, role: 'VIEWER' | 'EDITOR') {
  await page.getByRole('textbox', { name: 'User ID' }).fill(id)
  await page.getByRole('combobox', { name: 'Access', exact: true }).selectOption(role)
  await page.getByRole('button', { name: 'Grant access' }).click()
  await expect(page.getByText(id, { exact: true })).toBeVisible()
}

test('owner shares a workspace with a viewer and editor, then revokes and deletes', async ({ browser, page, baseURL }) => {
  const viewerContext = await browser.newContext({ baseURL })
  const editorContext = await browser.newContext({ baseURL })
  const suffix = Date.now()
  try {
    await page.goto('/workspaces')
    await expect(page).toHaveURL(/\/sign-in$/)
    const viewer = await viewerContext.newPage()
    const editor = await editorContext.newPage()
    await signUp(page, `owner-browser-${suffix}@example.com`)
    await signUp(viewer, `viewer-browser-${suffix}@example.com`)
    await signUp(editor, `editor-browser-${suffix}@example.com`)
    const viewerId = await userId(viewer)
    const editorId = await userId(editor)

    expect(await page.evaluate(() => typeof crypto.randomUUID)).toBe('function')
    await page.getByRole('textbox', { name: 'Workspace name' }).fill('Study group')
    await page.getByRole('button', { name: 'Create workspace' }).click()
    try {
      await expect(page.getByRole('heading', { name: 'Study group' })).toBeVisible()
    } catch (error) {
      throw new Error(`Workspace creation failed: ${await page.getByRole('alert').allTextContents()}`, { cause: error })
    }
    await page.getByRole('button', { name: 'Sharing', exact: true }).click()
    await grant(page, viewerId, 'VIEWER')
    await grant(page, editorId, 'EDITOR')

    await viewer.getByRole('link', { name: 'Back to workspaces' }).click()
    const viewed = viewer.getByRole('article', { name: 'Study group' })
    await expect(viewed).toBeVisible()
    await expect(viewed.getByRole('button', { name: 'Rename' })).toHaveCount(0)
    await editor.getByRole('link', { name: 'Back to workspaces' }).click()
    await editor.getByRole('button', { name: 'Rename', exact: true }).click()
    await editor.getByRole('textbox', { name: 'New name' }).fill('Research group')
    await editor.getByRole('button', { name: 'Save name' }).click()
    await expect(editor.getByRole('heading', { name: 'Research group' })).toBeVisible()
    await expect(editor.getByRole('button', { name: 'Sharing', exact: true })).toHaveCount(0)

    await page.getByRole('listitem').filter({ hasText: viewerId }).getByRole('button', { name: 'Revoke access' }).click()
    await expect(page.getByText(viewerId, { exact: true })).toHaveCount(0)
    await viewer.reload()
    await expect(viewer.getByText('You have no workspaces yet.')).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Research group' })).toBeVisible()
    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page.getByText('You have no workspaces yet.')).toBeVisible()

    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(page).toHaveURL(/\/sign-in$/)
    await page.goto('/workspaces')
    await expect(page).toHaveURL(/\/sign-in$/)
  } finally {
    await Promise.allSettled([viewerContext.close(), editorContext.close()])
  }
})

test('administrator can read the overview and filter user accounts', async ({ page }) => {
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill('phase01-admin@example.com')
  await page.getByLabel('Password', { exact: true }).fill('Phase1!a')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/workspaces$/)
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Operations overview' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Service health' })).toBeVisible()
  await page.getByRole('navigation', { name: 'Admin console navigation' })
    .getByRole('button', { name: 'Users', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search by email' }).fill('phase01-admin@example.com')
  const user = page.getByRole('row', { name: /phase01-admin@example\.com/ })
  await expect(user.getByRole('cell', { name: 'Current account' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'System configuration' })).toBeVisible()
})
