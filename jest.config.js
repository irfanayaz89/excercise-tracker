/** Tests run in plain Node: the engine and storage helpers have no React Native imports (native modules are mocked). */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          target: 'es2022',
          module: 'commonjs',
          moduleResolution: 'node',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          types: ['jest', 'node'],
          baseUrl: '.',
          paths: { '@/*': ['./src/*'] },
        },
        diagnostics: { warnOnly: false },
      },
    ],
  },
};
