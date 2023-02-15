module.exports = {
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    '@semantic-release/changelog',
    '@semantic-release/npm',
    '@semantic-release/git',
    '@semantic-release/exec',
  ],
  branches: ['main'],
  repositoryUrl: 'https://github.com/Seblor/soundpad.js',
  npmPublish: true,
  exec: {
    prepareCmd: 'npm run build',
  },
};
