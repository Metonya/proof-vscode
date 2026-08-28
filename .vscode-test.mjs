import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	tests: [
		{ files: 'out/test/integration/**/*.test.js' },
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
