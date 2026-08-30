import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	tests: [
		// Faz 31: `--disable-gpu` trims the Extension Host window's render
		// startup cost - not real headless (Windows has no equivalent to
		// Linux's `xvfb-run`), the window still flashes open, just cheaper.
		{ files: 'out/test/integration/**/*.test.js', launchArgs: ['--disable-gpu'] },
	],
	// Faz 27 (§7.4): src/ui/** ve extension.ts yalnızca gerçek Extension
	// Host testleriyle kapsanıyor - `npm run test:unit:coverage`'ın c8'i
	// bunları hiç görmüyordu, Sonar'ın new_coverage kapısı bu yüzden
	// yapısal olarak ERROR veriyordu (UI test edilmemiş demek değildi).
	// Yalnızca `--coverage` bayrağıyla toplanır (`test:integration:coverage`),
	// düz `test:integration` koşusunu yavaşlatmaz. Çıktı `coverage/` değil
	// `coverage-integration/` - unit testlerin kendi lcov'unu ezmesin diye.
	coverage: {
		include: ['src/ui/**', 'src/extension.ts'],
		exclude: ['src/test/**'],
		reporter: ['lcov', 'text-summary'],
		output: './coverage-integration',
	},
});
