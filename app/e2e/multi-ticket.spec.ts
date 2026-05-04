import { test, expect } from '@playwright/test'

/**
 * Flow: event multi-tickets (Coldplay seed — 3 billets).
 *
 * Coldplay a 3 tickets dans le seed. On vérifie :
 *   - tap sur la carte → CardDetail
 *   - indicateur "Billet 1 sur 3" visible
 *   - les dots de navigation (tablist) ont bien 3 items
 *   - navigation entre billets via les dots
 */

test.describe('Multi-tickets (Coldplay seed)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=Chargement…', { state: 'hidden', timeout: 10_000 })
    await expect(page.locator('text=Coldplay')).toBeVisible({ timeout: 10_000 })
  })

  test('tap Coldplay → CardDetail charge', async ({ page }) => {
    await page.locator('text=Coldplay').first().click()
    await expect(page).toHaveURL(/\/card\/[a-zA-Z0-9_-]+$/)
    await expect(page.locator('h1', { hasText: /Coldplay/i })).toBeVisible()
  })

  test('indicateur "Billet 1 sur 3" visible', async ({ page }) => {
    await page.locator('text=Coldplay').first().click()
    await page.waitForURL(/\/card\/[a-zA-Z0-9_-]+$/)

    // The TicketSwiper renders "Billet {n} sur {total}" when multiple tickets exist
    await expect(page.locator('text=Billet 1 sur 3')).toBeVisible({ timeout: 8_000 })
  })

  test('tablist de navigation avec 3 dots', async ({ page }) => {
    await page.locator('text=Coldplay').first().click()
    await page.waitForURL(/\/card\/[a-zA-Z0-9_-]+$/)

    const tabs = page.getByRole('tablist', { name: 'Billets' })
    await expect(tabs).toBeVisible()
    await expect(tabs.getByRole('tab')).toHaveCount(3)
  })

  test('naviguer vers le billet 2 via le dot → indicateur mis à jour', async ({ page }) => {
    await page.locator('text=Coldplay').first().click()
    await page.waitForURL(/\/card\/[a-zA-Z0-9_-]+$/)

    // Wait for initial indicator
    await expect(page.locator('text=Billet 1 sur 3')).toBeVisible({ timeout: 8_000 })

    // Click the second dot (tab index 1)
    const tabs = page.getByRole('tablist', { name: 'Billets' })
    await tabs.getByRole('tab', { name: 'Aller au billet 2' }).click()

    // The scroll is animated — wait a beat then check
    await expect(page.locator('text=Billet 2 sur 3')).toBeVisible({ timeout: 5_000 })
  })

  test('barcodes rendus pour les tickets (canvas ou img présent)', async ({ page }) => {
    await page.locator('text=Coldplay').first().click()
    await page.waitForURL(/\/card\/[a-zA-Z0-9_-]+$/)

    // At least one barcode should be rendered (canvas from bwip-js)
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 8_000 })
  })

  test('noms des porteurs visibles (Thibaut, Lucas, Mia)', async ({ page }) => {
    await page.locator('text=Coldplay').first().click()
    await page.waitForURL(/\/card\/[a-zA-Z0-9_-]+$/)

    // Ticket 1: Thibaut
    await expect(page.locator('text=Thibaut')).toBeVisible()

    // Navigate to ticket 2: Lucas
    const tabs = page.getByRole('tablist', { name: 'Billets' })
    await tabs.getByRole('tab', { name: 'Aller au billet 2' }).click()
    await expect(page.locator('text=Lucas')).toBeVisible({ timeout: 5_000 })

    // Navigate to ticket 3: Mia
    await tabs.getByRole('tab', { name: 'Aller au billet 3' }).click()
    await expect(page.locator('text=Mia')).toBeVisible({ timeout: 5_000 })
  })
})
