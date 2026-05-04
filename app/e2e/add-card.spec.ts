import { test, expect } from '@playwright/test'

/**
 * Flow: saisie manuelle d'une carte de fidélité.
 *
 * FAB → AddMenu → "Saisir / importer" → /add
 * Remplit : type loyalty, nom "Test Card", couleur, format EAN13, valeur valide.
 * Submit → redirige vers /card/<id>, le barcode apparaît.
 */

test.describe('Ajout manuel de carte', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=Chargement…', { state: 'hidden', timeout: 10_000 })
  })

  test('AddMenu s\'ouvre via le FAB', async ({ page }) => {
    const fab = page.getByRole('button', { name: 'Ajouter une carte' })
    await fab.click()

    // The AddMenu dialog should be visible
    await expect(page.getByRole('dialog', { name: 'Ajouter une carte' })).toBeVisible()
    await expect(page.locator('text=Scanner avec la caméra')).toBeVisible()
    await expect(page.locator('text=Saisir / importer une image')).toBeVisible()
  })

  test('AddMenu se ferme avec Escape', async ({ page }) => {
    await page.getByRole('button', { name: 'Ajouter une carte' }).click()
    await expect(page.getByRole('dialog', { name: 'Ajouter une carte' })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Ajouter une carte' })).not.toBeVisible()
  })

  test('"Saisir / importer" navigue vers /add', async ({ page }) => {
    await page.getByRole('button', { name: 'Ajouter une carte' }).click()
    await page.locator('text=Saisir / importer une image').click()

    await expect(page).toHaveURL(/\/add/)
    await expect(page.locator('text=Nouvelle carte')).toBeVisible()
  })

  test('formulaire loyalty complet → save → CardDetail avec barcode', async ({ page }) => {
    // Navigate directly to /add to skip the AddMenu
    await page.goto('/add')
    await page.waitForSelector('text=Nouvelle carte', { timeout: 10_000 })

    // Type selector: loyalty should be default, but click it explicitly
    await page.getByRole('button', { name: 'Carte de fidélité' }).click()

    // Name
    const nameInput = page.locator('input[placeholder="Carrefour"]')
    await nameInput.fill('Test Card')

    // Color: click a preset (any)
    const firstColor = page.locator('[aria-label^="Couleur"]').first()
    await firstColor.click()

    // Barcode format
    await page.selectOption('select', 'EAN13')

    // Barcode value — 13-digit EAN-13 with valid check digit
    const barcodeInput = page.locator('input[placeholder="0123456789012"]')
    await barcodeInput.fill('9780201379624')

    // Submit
    const submitBtn = page.getByRole('button', { name: 'Enregistrer la carte' })
    await expect(submitBtn).toBeEnabled()
    await submitBtn.click()

    // Should redirect to /card/<id>
    await expect(page).toHaveURL(/\/card\/[a-zA-Z0-9_-]+$/, { timeout: 10_000 })

    // Card name visible in header
    await expect(page.locator('text=Test Card')).toBeVisible()

    // Canvas barcode should be present (bwip-js renders into a <canvas>)
    // or a <img> for QR — for EAN13 bwip-js uses canvas
    await expect(page.locator('canvas').or(page.locator('img[alt]'))).toBeVisible({ timeout: 8_000 })
  })

  test('formulaire incomplet — submit désactivé', async ({ page }) => {
    await page.goto('/add')
    await page.waitForSelector('text=Nouvelle carte', { timeout: 10_000 })

    // Name is empty by default — submit should be disabled
    const submitBtn = page.getByRole('button', { name: 'Enregistrer la carte' })
    await expect(submitBtn).toBeDisabled()

    // Fill name only; barcode value still empty → still disabled for loyalty
    await page.locator('input[placeholder="Carrefour"]').fill('My Card')
    // Format is QR by default, value is empty → disabled
    await expect(submitBtn).toBeDisabled()
  })
})
