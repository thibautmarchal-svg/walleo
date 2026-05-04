import { test, expect } from '@playwright/test'

/**
 * Flow: scanner caméra.
 *
 * On ne peut pas décoder un vrai barcode en test — l'objectif est :
 *   1. Vérifier que la page /scan se charge.
 *   2. Vérifier que getUserMedia est intercepté proprement (pas d'erreur
 *      fatale qui crashe l'app).
 *   3. Vérifier que l'UI de scan (cadre jaune / viewfinder) apparaît,
 *      ou qu'un message d'erreur clair s'affiche si la caméra est refusée.
 *
 * Note: WebKit desktop ne supporte pas getUserMedia sans HTTPS.
 * Le test est donc marqué skip sur mobile-safari en contexte headless CI
 * mais sera exécuté sur desktop-chrome.
 */

test.describe('Scanner caméra', () => {
  test('naviguer vers /scan depuis le FAB + AddMenu', async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('text=Chargement…', { state: 'hidden', timeout: 10_000 })

    await page.getByRole('button', { name: 'Ajouter une carte' }).click()
    await expect(page.getByRole('dialog', { name: 'Ajouter une carte' })).toBeVisible()

    await page.locator('text=Scanner avec la caméra').click()
    await expect(page).toHaveURL(/\/scan/)
  })

  test('/scan se charge et affiche l\'interface (getUserMedia mocké → refus)', async ({ page, browserName }) => {
    // On WebKit headless, camera access will be denied automatically.
    // We mock getUserMedia to immediately throw a NotAllowedError so we
    // can assert that the app handles it gracefully (message + fallback).
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaDevices', {
        writable: true,
        value: {
          getUserMedia: () =>
            Promise.reject(
              Object.assign(new Error('NotAllowedError'), {
                name: 'NotAllowedError',
              }),
            ),
          enumerateDevices: () => Promise.resolve([]),
        },
      })
    })

    await page.goto('/scan')

    // Give the scanner component time to initialize and detect the denial
    await page.waitForTimeout(2_000)

    // The scanner page should be visible (not a crash/blank page)
    // Accept either a viewfinder OR an error/fallback message
    const hasViewfinder = await page.locator('video, canvas').isVisible().catch(() => false)
    const hasError = await page
      .locator('text=/caméra|autorisation|accès|permission|NotAllowed|refusé/i')
      .isVisible()
      .catch(() => false)

    expect(
      hasViewfinder || hasError,
      `Expected scanner UI or camera error message to be visible on ${browserName}`,
    ).toBe(true)
  })

  test('/scan affiche un bouton de fermeture même en cas d\'erreur caméra', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaDevices', {
        writable: true,
        value: {
          getUserMedia: () =>
            Promise.reject(
              Object.assign(new Error('NotAllowedError'), { name: 'NotAllowedError' }),
            ),
          enumerateDevices: () => Promise.resolve([]),
        },
      })
    })

    await page.goto('/scan')
    await page.waitForTimeout(2_000)

    // The scanner renders an "Annuler" button (aria-label) to go back,
    // which is the user's escape hatch when camera fails.
    const closeBtn = page.getByRole('button', { name: /annuler|fermer|retour/i })
    await expect(closeBtn).toBeVisible({ timeout: 8_000 })
  })
})
