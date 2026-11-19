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

test('mobile viewport supports tab switching, preserves draft state across tabs, and switches to reader on citation click', async ({ page }) => {
  const workspace = process.env.PHASE03_WORKSPACE_ID
  expect(workspace).toBeTruthy()
  await page.setViewportSize({ width: 375, height: 667 })
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill('phase03@example.com')
  await page.getByLabel('Password', { exact: true }).fill('Phase3!a')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/workspaces$/)
  await page.goto('/workspaces/' + workspace)

  // Verify tab switcher exists on mobile viewport
  const tablist = page.getByRole('tablist', { name: 'Workspace views' })
  await expect(tablist).toBeVisible()
  const assistantTab = page.getByRole('tab', { name: 'Assistant' })
  const sourcesTab = page.getByRole('tab', { name: 'Sources' })
  const readerTab = page.getByRole('tab', { name: 'Reader' })
  await expect(assistantTab).toBeVisible()
  await expect(sourcesTab).toBeVisible()
  await expect(readerTab).toBeVisible()

  // Ensure Assistant tab is active
  await assistantTab.click()
  await expect(assistantTab).toHaveAttribute('aria-selected', 'true')

  const assistant = page.getByRole('region', { name: 'Workspace assistant' })
  await expect(assistant).toBeVisible()

  // Enter draft input in form
  const draftQuery = 'Mobile draft preservation query'
  await assistant.getByLabel('Question or objective').fill(draftQuery)
  await assistant.getByRole('checkbox', { name: 'study.pdf', exact: true }).check()

  // Switch to Sources tab
  await sourcesTab.click()
  await expect(sourcesTab).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: 'Documents' })).toBeVisible()

  // Switch to Reader tab
  await readerTab.click()
  await expect(readerTab).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('region', { name: 'Document preview' })).toBeVisible()

  // Switch back to Assistant tab and verify state preservation
  await assistantTab.click()
  await expect(assistantTab).toHaveAttribute('aria-selected', 'true')
  await expect(assistant.getByLabel('Question or objective')).toHaveValue(draftQuery)
  await expect(assistant.getByRole('checkbox', { name: 'study.pdf', exact: true })).toBeChecked()

  // Create and run plan
  await assistant.getByLabel('Mode', { exact: true }).selectOption('PLAN')
  await assistant.getByRole('button', { name: 'Create plan' }).click()
  await expect(assistant.getByRole('heading', { name: /Plan version \d+/ })).toBeVisible()
  await assistant.getByRole('button', { name: 'Accept', exact: true }).click()
  await assistant.getByRole('button', { name: 'Run accepted plan' }).click()

  const citation = assistant.getByRole('button', { name: /study\.pdf, page \d+/ }).first()
  await expect(citation).toBeVisible({ timeout: 30000 })
  const number = (await citation.textContent())?.match(/page (\d+)/)?.[1]

  // Clicking citation must switch mobile active tab to Reader and navigate to page
  await citation.click()
  await expect(readerTab).toHaveAttribute('aria-selected', 'true')
  await expect(page).toHaveURL(new RegExp('[?&]page=' + number + '(&|$)'))
  await expect(page.getByRole('img', { name: 'PDF page ' + number, exact: true })).toBeVisible()
})

test('keyboard accessibility, focus navigation, and accessible names', async ({ page }) => {
  const workspace = process.env.PHASE03_WORKSPACE_ID
  expect(workspace).toBeTruthy()
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill('phase03@example.com')
  await page.getByLabel('Password', { exact: true }).fill('Phase3!a')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/workspaces$/)
  await page.goto('/workspaces/' + workspace)

  const assistant = page.getByRole('region', { name: 'Workspace assistant' })
  await expect(assistant).toBeVisible()

  // Verify accessible names on interactive form controls
  const modeSelect = assistant.getByLabel('Mode', { exact: true })
  const capabilitySelect = assistant.getByLabel('Capability', { exact: true })
  const outputSelect = assistant.getByLabel('Output', { exact: true })
  const queryInput = assistant.getByLabel('Question or objective', { exact: true })
  const studyPdfCheckbox = assistant.getByRole('checkbox', { name: 'study.pdf', exact: true })
  const submitButton = assistant.getByRole('button', { name: 'Send' })

  await expect(modeSelect).toBeVisible()
  await expect(capabilitySelect).toBeVisible()
  await expect(outputSelect).toBeVisible()
  await expect(queryInput).toBeVisible()
  await expect(studyPdfCheckbox).toBeVisible()
  await expect(submitButton).toBeVisible()

  // Keyboard focus navigation
  await queryInput.focus()
  await expect(queryInput).toBeFocused()
  await page.keyboard.type('Keyboard navigation test')
  await expect(queryInput).toHaveValue('Keyboard navigation test')

  // Document preview status role or page counter live region
  const documentPreview = page.getByRole('region', { name: 'Document preview' })
  await expect(documentPreview).toBeVisible()
  const statusOrLive = page.locator('[role="status"], [aria-live]')
  expect(await statusOrLive.count()).toBeGreaterThan(0)
})

test('handles validation errors and plan cancellation lifecycle', async ({ page }) => {
  const workspace = process.env.PHASE03_WORKSPACE_ID
  expect(workspace).toBeTruthy()
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill('phase03@example.com')
  await page.getByLabel('Password', { exact: true }).fill('Phase3!a')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/workspaces$/)
  await page.goto('/workspaces/' + workspace)

  const assistant = page.getByRole('region', { name: 'Workspace assistant' })
  await expect(assistant).toBeVisible()

  // Validation error state: question filled but no source checked
  await assistant.getByLabel('Question or objective').fill('Query without sources')
  const studyPdf = assistant.getByRole('checkbox', { name: 'study.pdf', exact: true })
  if (await studyPdf.isChecked()) {
    await studyPdf.uncheck()
  }
  await assistant.getByRole('button', { name: 'Send' }).click()
  const alert = assistant.getByRole('alert')
  await expect(alert).toBeVisible()
  await expect(alert).toHaveText('Enter a question and choose between 1 and 100 sources.')

  // Create a plan to test cancellation
  await assistant.getByLabel('Mode', { exact: true }).selectOption('PLAN')
  await assistant.getByRole('checkbox', { name: 'study.pdf', exact: true }).check()
  await assistant.getByRole('button', { name: 'Create plan' }).click()
  await expect(assistant.getByRole('heading', { name: /Plan version \d+/ })).toBeVisible()

  // Plan cancellation
  const cancelButton = assistant.getByRole('button', { name: 'Cancel plan' })
  await expect(cancelButton).toBeVisible()
  await cancelButton.click()

  // Verify cancelled plan state
  await expect(assistant.getByText('Plan cancelled.')).toBeVisible()
  await expect(assistant.getByRole('button', { name: 'Accept' })).toHaveCount(0)
  await expect(assistant.getByRole('button', { name: 'Run accepted plan' })).toHaveCount(0)
})
