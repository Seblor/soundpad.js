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
  repositoryUrl: '<YOUR_GITHUB_REPOSITORY_URL>',
  npmPublish: true,
  exec: {
    prepareCmd: 'npm run build',
  },
};
