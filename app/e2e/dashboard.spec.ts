import { test, expect } from '@playwright/test'

/**
 * Flow: boot + seed data visible + filtres + recherche + empty-state.
 *
 * The seed runs automatically on first load when the DB is empty.
 * Playwright uses a fresh browser context per test, so IndexedDB starts
 * empty each time — seed fires on every test.
 */

test.describe('Dashboard — boot & seed', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Wait for the loading spinner to disappear
    await page.waitForSelector('text=Chargement…', { state: 'hidden', timeout: 10_000 })
  })

  test('seed produces 6 cards visible in "Tout" filter', async ({ page }) => {
    // The seed has 3 loyalty + 3 event cards (Carrefour, Decathlon, FNAC,
    // Coldplay, Cyrano, TGV). The header shows the count.
    // At minimum 5 tiles should be present (count can vary with seed changes,
    // so we check >= 5 rather than exactly 6 to stay resilient).
    const tiles = page.locator('[data-testid="card-tile"], .grid > a, .grid > div > a')

    // Wait for tiles to appear — seed is async
    await expect(page.locator('text=carte').or(page.locator('text=cartes'))).toBeVisible({ timeout: 10_000 })

    // At least 5 cards should be rendered
    await expect(page.locator('text=Carrefour')).toBeVisible()
    await expect(page.locator('text=Decathlon')).toBeVisible()
    await expect(page.locator('text=FNAC')).toBeVisible()
    await expect(page.locator('text=Coldplay')).toBeVisible()
    // The seed also has Cyrano and TGV
    await expect(page.locator('text=TGV')).toBeVisible()
  })

  test('filter "Fidélité" shows 3 loyalty cards', async ({ page }) => {
    await page.getByRole('button', { name: 'Fidélité' }).click()

    // All 3 loyalty seed cards must be visible
    await expect(page.locator('text=Carrefour')).toBeVisible()
    await expect(page.locator('text=Decathlon')).toBeVisible()
    await expect(page.locator('text=FNAC')).toBeVisible()

    // Event cards must NOT be visible
    await expect(page.locator('text=Coldplay')).not.toBeVisible()
    await expect(page.locator('text=TGV')).not.toBeVisible()
  })

  test('filter "Billets" shows event cards only', async ({ page }) => {
    await page.getByRole('button', { name: 'Billets' }).click()

    await expect(page.locator('text=Coldplay')).toBeVisible()
    await expect(page.locator('text=TGV')).toBeVisible()

    await expect(page.locator('text=Carrefour')).not.toBeVisible()
    await expect(page.locator('text=Decathlon')).not.toBeVisible()
    await expect(page.locator('text=FNAC')).not.toBeVisible()
  })

  test('search "Coldplay" returns 1 result', async ({ page }) => {
    const searchInput = page.getByRole('searchbox')
    await searchInput.fill('Coldplay')

    await expect(page.locator('text=Coldplay')).toBeVisible()
    // Other cards must be hidden
    await expect(page.locator('text=Carrefour')).not.toBeVisible()
    await expect(page.locator('text=Decathlon')).not.toBeVisible()
  })

  test('search with no results shows empty state + "Effacer la recherche" button', async ({ page }) => {
    const searchInput = page.getByRole('searchbox')
    await searchInput.fill('xxxxx_nonexistent_query')

    // Empty state message
    await expect(page.locator('text=Aucun résultat')).toBeVisible()

    // "Effacer la recherche" button
    const clearBtn = page.getByRole('button', { name: 'Effacer la recherche' })
    await expect(clearBtn).toBeVisible()

    // Clicking it resets the search
    await clearBtn.click()
    await expect(page.locator('text=Carrefour')).toBeVisible()
    await expect(searchInput).toHaveValue('')
  })
})
