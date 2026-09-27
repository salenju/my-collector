import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'inbox', component: () => import('@/views/InboxView.vue') },
    { path: '/new', name: 'new', component: () => import('@/views/NewItemView.vue') },
    {
      path: '/item/:id',
      name: 'item',
      component: () => import('@/views/ItemDetailView.vue'),
      props: true,
    },
    { path: '/tags', name: 'tags', component: () => import('@/views/TagsView.vue') },
    { path: '/settings', name: 'settings', component: () => import('@/views/SettingsView.vue') },
    { path: '/about', name: 'about', component: () => import('@/views/AboutView.vue') },
    { path: '/share', name: 'share', component: () => import('@/views/ShareView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
});
