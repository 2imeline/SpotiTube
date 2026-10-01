<script lang="ts">
  import { ui } from '../stores/ui.svelte';
  let values = $state<Record<string, string>>({});
  $effect(() => {
    const d = ui.dialog;
    values = {};
    if (d?.fields) for (const f of d.fields) values[f.key] = f.value;
  });
  function submit(e?: Event) {
    e?.preventDefault();
    const d = ui.dialog!;
    d.resolve(d.kind === 'prompt' ? { ...values } : true);
  }
  function cancel() {
    ui.dialog?.resolve(null);
  }
</script>

{#if ui.dialog}
  {@const d = ui.dialog}
  <div class="dialog-backdrop" role="presentation" onmousedown={(e) => e.target === e.currentTarget && cancel()}>
    <form class="dialog" onsubmit={submit} aria-label={d.title}>
      <h2>{d.title}</h2>
      {#if d.message}<p>{d.message}</p>{/if}
      {#if d.kind === 'prompt'}
        {#each d.fields ?? [] as f, i}
          <div class="field">
            <label for="f-{f.key}">{f.label}</label>
            {#if f.options}
              <select id="f-{f.key}" class="input" bind:value={values[f.key]}>
                {#each f.options as o}<option value={o}>{o[0] + o.slice(1).toLowerCase()}</option>{/each}
              </select>
            {:else if f.multiline}
              <textarea id="f-{f.key}" class="input" bind:value={values[f.key]}></textarea>
            {:else}
              <!-- svelte-ignore a11y_autofocus -->
              <input id="f-{f.key}" class="input" bind:value={values[f.key]} autofocus={i === 0} autocomplete="off" />
            {/if}
          </div>
        {/each}
      {:else if d.kind === 'credits'}
        {#each d.data ?? [] as sec}
          <div style="margin-bottom:16px">
            <div style="font-weight:700;margin-bottom:4px">{sec.title}</div>
            {#each sec.names as n}<div style="color:var(--text-sub)">{n}</div>{/each}
          </div>
        {:else}<p>No credits available.</p>{/each}
      {/if}
      <div class="dialog-actions">
        {#if d.kind === 'credits' || d.kind === 'info'}
          <button type="button" class="pill-btn" onclick={() => d.resolve(true)}>Close</button>
        {:else}
          <button type="button" class="pill-btn ghost" onclick={cancel}>Cancel</button>
          <button type="submit" class="pill-btn">{d.confirmLabel ?? 'OK'}</button>
        {/if}
      </div>
    </form>
  </div>
{/if}
