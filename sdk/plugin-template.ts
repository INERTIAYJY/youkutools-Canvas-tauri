/**
 * plugin-template — 演示插件工具与节点处理器的最小注册方式。
 */
definePlugin({
  tools: {
    uppercase: async (input) => {
      const text = String(input.node.data.output ?? '');
      return { data: { output: text.toUpperCase() } };
    },
  },
});
