<script lang="ts">
  interface Props {
    username: string;
  }

  const { username }: Props = $props();
</script>

<!-- Lets password managers file the passphrase under the repository. -->
<input
  class="visually-hidden"
  type="text"
  name="username"
  autocomplete="username"
  value={username}
  readonly
  tabindex="-1"
  aria-hidden="true"
/>
