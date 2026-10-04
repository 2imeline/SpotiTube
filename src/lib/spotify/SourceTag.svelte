<script lang="ts">
  import Icon from '../components/Icon.svelte';
  let { source, label }: { source: 'spotify' | 'ytm'; label?: string } = $props();
</script>

<span class="src-tag {source}" title={source === 'spotify' ? 'From Spotify' : 'From YouTube Music'}>
  <Icon name={source === 'spotify' ? 'spotify' : 'ytmusic'} size={12} />
  {label ?? (source === 'spotify' ? 'Spotify' : 'YouTube Music')}
</span>
