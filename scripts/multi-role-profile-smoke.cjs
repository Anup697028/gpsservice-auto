'use strict';

const fs = require('node:fs');
const path = require('node:path');

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:4173';
const HEADLESS = process.env.HEADLESS !== 'false';
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 20000);
const STRICT_CREDENTIALS = process.env.STRICT_CREDENTIALS === 'true';

const ROLE_SCENARIOS = [
  { role: 'RH', route: '/rh-profile', emailEnv: 'RH_EMAIL', passwordEnv: 'RH_PASSWORD' },
  { role: 'PAYMENT', route: '/payment-profile', emailEnv: 'PAYMENT_EMAIL', passwordEnv: 'PAYMENT_PASSWORD' },
  { role: 'VENDOR', route: '/vendor-profile', emailEnv: 'VENDOR_EMAIL', passwordEnv: 'VENDOR_PASSWORD' },
];

const OUTPUT_DIR = path.resolve(process.cwd(), 'artifacts', 'profile-smoke');

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const timeTag = () => new Date().toISOString().replace(/[:.]/g, '-');

const safeName = (value) => String(value || '').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();

const hasVisible = async (locator) => {
  try {
    return await locator.first().isVisible({ timeout: 3000 });
  } catch {
    return false;
  }
};

const getBodyText = async (page) => {
  try {
    return await page.locator('body').innerText();
  } catch {
    return '';
  }
};

const completeProfileModalIfVisible = async (page, role) => {
  const bodyText = await getBodyText(page);
  const modalVisible = /complete your profile/i.test(bodyText);

  if (!modalVisible) {
    return false;
  }

  const fullName = page.locator('input[placeholder="Enter your full name"]');
  const employeeId = page.locator('input[placeholder="Enter your employee ID"]');
  const phone = page.locator('input[placeholder="10-digit mobile number"]');
  const saveButton = page.getByRole('button', { name: /save & continue/i });

  if ((await fullName.count()) > 0) {
    await fullName.fill(`${role} User`);
  }

  if ((await employeeId.count()) > 0) {
    await employeeId.fill(`${role}-1001`);
  }

  if ((await phone.count()) > 0) {
    await phone.fill('9876543210');
  }

  if ((await saveButton.count()) > 0) {
    await saveButton.click();
    await page.waitForTimeout(1500);
  }

  return true;
};

const runRoleScenario = async (browser, scenario, reportDir) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const result = {
    role: scenario.role,
    profileRouteLoaded: false,
    hasPersonalInfoSection: false,
    hasSecuritySettingsSection: false,
    hasRegionalAssignmentSection: false,
    hasPhoneInput: false,
    hasPasswordChangeButton: false,
    profileCompletionModalVisible: false,
    errors: [],
  };

  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });

    await page.fill('#email', scenario.email);
    await page.fill('#password', scenario.password);

    await Promise.allSettled([
      page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: TIMEOUT_MS }),
      page.getByRole('button', { name: /access dashboard/i }).click(),
    ]);

    const loginErrorVisible = await hasVisible(
      page.getByText(/invalid email or password|login failed|too many login attempts|network error/i)
    );

    if (loginErrorVisible) {
      result.errors.push('Login failed for role credentials.');
      return result;
    }

    await page.goto(`${BASE_URL}${scenario.route}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
    await page.waitForURL((url) => url.pathname.includes(scenario.route), { timeout: TIMEOUT_MS });

    await page.waitForFunction(
      () => {
        const text = (document.body && document.body.innerText) || '';
        return /personal information|complete your profile|access denied/i.test(text);
      },
      null,
      { timeout: TIMEOUT_MS }
    );

    await completeProfileModalIfVisible(page, scenario.role);
    await page.waitForTimeout(1000);

    const bodyText = await getBodyText(page);

    result.profileRouteLoaded = page.url().includes(scenario.route);
    result.hasPersonalInfoSection = /personal information/i.test(bodyText);
    result.hasSecuritySettingsSection = /security settings/i.test(bodyText);
    result.hasRegionalAssignmentSection = /regional assignment/i.test(bodyText);
    result.hasPhoneInput = (await page.locator('input[placeholder="10-digit mobile number"]').count()) > 0;
    result.hasPasswordChangeButton = /change password/i.test(bodyText);
    result.profileCompletionModalVisible = /complete your profile/i.test(bodyText);

    if (!result.profileRouteLoaded) {
      result.errors.push(`Expected route ${scenario.route} but got ${page.url()}.`);
    }
    if (!result.hasPersonalInfoSection) {
      result.errors.push('Missing Personal Information section.');
    }
    if (!result.hasSecuritySettingsSection) {
      result.errors.push('Missing Security Settings section.');
    }
    if (result.hasRegionalAssignmentSection) {
      result.errors.push('Regional Assignment section is still visible.');
    }
    if (!result.hasPhoneInput) {
      result.errors.push('Missing phone number input.');
    }
    if (!result.hasPasswordChangeButton) {
      result.errors.push('Missing Change Password button.');
    }

    if (result.errors.length > 0) {
      const screenshotPath = path.join(reportDir, `${safeName(scenario.role)}-failure.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      result.errors.push(`Failure screenshot: ${screenshotPath}`);
    }

    return result;
  } catch (error) {
    const screenshotPath = path.join(reportDir, `${safeName(scenario.role)}-exception.png`);
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true });
    } catch {
      // Ignore screenshot failures after navigation errors.
    }

    result.errors.push(String(error && error.message ? error.message : error));
    result.errors.push(`Exception screenshot: ${screenshotPath}`);
    return result;
  } finally {
    await context.close();
  }
};

const main = async () => {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    console.error('Playwright is not installed. Run: npm install --save-dev playwright');
    process.exit(1);
  }

  const scenarios = ROLE_SCENARIOS.map((scenario) => {
    const email = process.env[scenario.emailEnv] || '';
    const password = process.env[scenario.passwordEnv] || '';
    return { ...scenario, email, password };
  });

  const runnable = scenarios.filter((scenario) => scenario.email && scenario.password);
  const missing = scenarios.filter((scenario) => !(scenario.email && scenario.password));

  if (STRICT_CREDENTIALS && missing.length > 0) {
    console.error('Missing required credentials in strict mode:');
    for (const scenario of missing) {
      console.error(`- ${scenario.role}: set ${scenario.emailEnv} and ${scenario.passwordEnv}`);
    }
    process.exit(1);
  }

  if (runnable.length === 0) {
    console.error('No role credentials provided. Set at least one of:');
    for (const scenario of scenarios) {
      console.error(`- ${scenario.emailEnv} and ${scenario.passwordEnv}`);
    }
    process.exit(1);
  }

  ensureDir(OUTPUT_DIR);
  const runDir = path.join(OUTPUT_DIR, timeTag());
  ensureDir(runDir);

  const browser = await chromium.launch({ headless: HEADLESS });
  const results = [];

  try {
    for (const scenario of runnable) {
      // Run serially to keep auth/session behavior deterministic per role.
      const result = await runRoleScenario(browser, scenario, runDir);
      results.push(result);
    }
  } finally {
    await browser.close();
  }

  const failed = results.filter((item) => item.errors.length > 0);
  const passed = results.filter((item) => item.errors.length === 0);

  const report = {
    baseUrl: BASE_URL,
    headless: HEADLESS,
    timeoutMs: TIMEOUT_MS,
    strictCredentials: STRICT_CREDENTIALS,
    skippedRoles: missing.map((item) => ({
      role: item.role,
      reason: `Missing ${item.emailEnv} or ${item.passwordEnv}`,
    })),
    passedCount: passed.length,
    failedCount: failed.length,
    results,
  };

  const reportPath = path.join(runDir, 'report.json');
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log('Multi-role profile smoke test completed.');
  console.log(`Report: ${reportPath}`);
  console.log(`Passed: ${passed.length} | Failed: ${failed.length} | Skipped: ${missing.length}`);

  for (const item of results) {
    console.log(JSON.stringify(item));
  }

  if (failed.length > 0) {
    process.exit(1);
  }
};

main().catch((error) => {
  console.error('Unhandled smoke test error:', error);
  process.exit(1);
});
