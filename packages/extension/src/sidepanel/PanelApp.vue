<script setup lang="ts">
/**
 * 侧边栏外壳：与 popup 共用 shared/CollectForm.vue，见 06 文档 §5.6。
 * 差异：信息来自后台捕获的 storage.session 上下文、底部按钮是「重新读取当前页」、
 * 保存成功后面板保持打开（chrome.sidePanel 没有 close API）。
 */
import CollectForm from '../shared/CollectForm.vue';
</script>

<template>
  <CollectForm mode="panel" />
</template>
