import { expect, test } from '@playwright/test'

test('an accepted plan returns a citation that opens its PDF page', async ({ page }) => {
  const workspace = process.env.PHASE03_WORKSPACE_ID
  expect(workspace).toBeTruthy()
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill('phase03@example.com')
  await page.getByLabel('Password', { exact: true }).fill('Phase3!a')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/workspaces$/)
  await page.goto('/workspaces/' + workspace)
  const assistant = page.getByRole('region', { name: 'Workspace assistant' })
  await assistant.getByLabel('Mode', { exact: true }).selectOption('PLAN')
  await assistant.getByLabel('Question or objective').fill('What is the academic source?')
  await assistant.getByRole('checkbox', { name: 'study.pdf', exact: true }).check()
  await assistant.getByRole('button', { name: 'Create plan' }).click()
  await expect(assistant.getByRole('heading', { name: 'Plan version 1' })).toBeVisible()
  await assistant.getByRole('button', { name: 'Accept', exact: true }).click()
  await assistant.getByRole('button', { name: 'Run accepted plan' }).click()
  const citation = assistant.getByRole('button', { name: /study\.pdf, page \d+/ }).first()
  await expect(citation).toBeVisible({ timeout: 30000 })
  const number = (await citation.textContent())?.match(/page (\d+)/)?.[1]
  await citation.click()
  await expect(page).toHaveURL(new RegExp('[?&]page=' + number + '(&|$)'))
  await expect(page.getByRole('img', { name: 'PDF page ' + number, exact: true })).toBeVisible()
})
