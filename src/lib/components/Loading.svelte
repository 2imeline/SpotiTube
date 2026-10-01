<script lang="ts">
  let { error = null, retry }: { error?: string | null; retry?: () => void } = $props();
</script>

{#if error}
  <div class="center-msg">
    <h2>Couldn't load this page</h2>
    <div style="max-width:520px">{error}</div>
    {#if retry}<button class="pill-btn" onclick={retry}>Try again</button>{/if}
  </div>
{:else}
  <div style="padding:96px 24px 24px">
    <div style="display:flex;gap:24px;align-items:flex-end">
      <div class="skeleton" style="width:200px;height:200px"></div>
      <div style="flex:1">
        <div class="skeleton" style="height:16px;width:80px;margin-bottom:16px"></div>
        <div class="skeleton" style="height:56px;width:60%;margin-bottom:16px"></div>
        <div class="skeleton" style="height:14px;width:40%"></div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(176px,1fr));gap:24px;margin-top:48px">
      {#each Array(6) as _}<div><div class="skeleton" style="aspect-ratio:1;margin-bottom:12px"></div><div class="skeleton" style="height:14px;width:80%"></div></div>{/each}
    </div>
  </div>
{/if}
