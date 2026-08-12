<script lang="ts">
  import { icons, type IconName } from "../util/icons.ts";

  let {
    name,
    size = 20,
    class: className = "",
  }: {
    name: IconName;
    size?: number;
    class?: string;
  } = $props();
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  class="lucide lucide-{name}-icon lucide-{name} {className}"
  aria-hidden="true"
>
  {@html icons[name]}
</svg>
