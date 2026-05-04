import { test, expect } from '@playwright/test'

/**
 * Flow: édition d'une carte existante + suppression via AlertDialog.
 * On travaille sur la carte "Carrefour" du seed.
 */

test.describe('Édition et suppression de carte', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=Chargement…', { state: 'hidden', timeout: 10_000 })
    // Wait for the seed to populate
    await expect(page.locator('text=Carrefour')).toBeVisible({ timeout: 10_000 })
  })

  test('tap Carrefour → CardDetail affiche le nom', async ({ page }) => {
    await page.locator('text=Carrefour').first().click()
    await expect(page).toHaveURL(/\/card\/[a-zA-Z0-9_-]+$/)
    await expect(page.locator('h1', { hasText: 'Carrefour' })).toBeVisible()
  })

  test('bouton crayon → /edit → form pré-rempli avec "Carrefour"', async ({ page }) => {
    await page.locator('text=Carrefour').first().click()
    await page.waitForURL(/\/card\/[a-zA-Z0-9_-]+$/)

    await page.getByRole('button', { name: 'Modifier' }).click()
    await expect(page).toHaveURL(/\/card\/[a-zA-Z0-9_-]+\/edit$/)

    // Name input should contain 'Carrefour'
    await expect(page.locator('input[placeholder="Carrefour"]')).toHaveValue('Carrefour')
  })

  test('modifier le nom → save → CardDetail affiche le nouveau nom', async ({ page }) => {
    await page.locator('text=Carrefour').first().click()
    await page.waitForURL(/\/card\/[a-zA-Z0-9_-]+$/)
    await page.getByRole('button', { name: 'Modifier' }).click()
    await page.waitForURL(/\/edit$/)

    const nameInput = page.locator('input[placeholder="Carrefour"]')
    await nameInput.clear()
    await nameInput.fill('Carrefour Updated')

    await page.getByRole('button', { name: 'Enregistrer les modifications' }).click()

    await expect(page).toHaveURL(/\/card\/[a-zA-Z0-9_-]+$/)
    await expect(page.locator('h1', { hasText: 'Carrefour Updated' })).toBeVisible()
  })

  test('bouton poubelle → AlertDialog visible', async ({ page }) => {
    await page.locator('text=Carrefour').first().click()
    await page.waitForURL(/\/card\/[a-zA-Z0-9_-]+$/)

    await page.getByRole('button', { name: 'Supprimer' }).click()

    // AlertDialog should contain the card name
    await expect(page.locator('[role="alertdialog"]')).toBeVisible()
    await expect(page.locator('text=Supprimer')).toBeVisible()
  })

  test('"Annuler" dans AlertDialog ferme le dialog, carte toujours là', async ({ page }) => {
    await page.locator('text=Carrefour').first().click()
    await page.waitForURL(/\/card\/[a-zA-Z0-9_-]+$/)

    await page.getByRole('button', { name: 'Supprimer' }).click()
    await expect(page.locator('[role="alertdialog"]')).toBeVisible()

    await page.getByRole('button', { name: 'Annuler' }).click()
    await expect(page.locator('[role="alertdialog"]')).not.toBeVisible()

    // Still on card detail
    await expect(page).toHaveURL(/\/card\/[a-zA-Z0-9_-]+$/)
    await expect(page.locator('h1', { hasText: 'Carrefour' })).toBeVisible()
  })

  test('confirmer la suppression → retour dashboard, carte absente', async ({ page }) => {
    await page.locator('text=Carrefour').first().click()
    await page.waitForURL(/\/card\/[a-zA-Z0-9_-]+$/)

    await page.getByRole('button', { name: 'Supprimer' }).click()
    await expect(page.locator('[role="alertdialog"]')).toBeVisible()

    // The destructive button in the AlertDialog — match by role + name
    // The AlertDialog has two "Supprimer" buttons: the header one and the
    // confirmation one inside the dialog footer. We target the one inside
    // the dialog.
    const dialog = page.locator('[role="alertdialog"]')
    await dialog.getByRole('button', { name: 'Supprimer' }).click()

    // Should navigate back to dashboard
    await expect(page).toHaveURL('/', { timeout: 10_000 })

    // Carrefour should not appear in the list anymore
    await expect(page.locator('text=Carrefour')).not.toBeVisible()
  })
})
