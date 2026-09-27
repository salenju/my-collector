<script setup lang="ts">
/**
 * 工具栏弹窗外壳：表单本身在 shared/CollectForm.vue，见 06 文档 §5.6。
 * 与面板的差异只有：信息来自"现场读当前标签页"、底部有「取消」、保存成功后自动关闭。
 */
import CollectForm from '../shared/CollectForm.vue';
</script>

<template>
  <CollectForm mode="popup" />
</template>
