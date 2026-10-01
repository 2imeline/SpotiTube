<script lang="ts">
  import { ui } from '../stores/ui.svelte';
</script>

<div class="toasts" aria-live="polite">
  {#each ui.toasts as t (t.id)}
    <div class="toast" class:error={t.kind === 'error'}>{t.text}</div>
  {/each}
</div>
