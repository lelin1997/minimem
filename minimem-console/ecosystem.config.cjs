module.exports = {
  apps: [{
    name: 'minimem-console',
    script: 'npx',
    args: 'tsx server/index.ts',
    cwd: '/root/minimem/minimem-console',
    interpreter: 'none',
    env: {
      // REST API 不再需要 JWT（insecure 模式）
      // MINIMEM_API_TOKEN 不设置
    }
  }]
}
