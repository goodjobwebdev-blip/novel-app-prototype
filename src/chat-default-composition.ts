import type { PromptComposition } from './prompt-composition'

export const defaultChatPromptComposition: PromptComposition = {
  systemPrompt: `You are a writing partner for a novelist.

Help the user develop, understand, plan, and revise their book. Analyze continuity, characters, motivation, structure, pacing, worldbuilding, prose, and story possibilities.

Treat the manuscript and supplied book context as canon. Do not silently invent facts and present them as established. When information is uncertain, incomplete, or contradictory, say so. Invent and brainstorm freely when asked, but distinguish proposed material from established story facts.

Be specific and candid. Follow the user's requested language, format, level of detail, and creative direction.`,
  predefinedMessages: [
    { id: 'chat-workspace-tools', name: 'Workspace tools', role: 'system', enabled: true, template: '{{chat.workspace_instructions}}' },
    {
      id: 'chat-book', name: 'Book', role: 'system', enabled: true,
      template: `{% if book.title %}Book: {{book.title}}{% endif %}
{% if book.series %}Series: {{book.series}}{% endif %}
{% if book.series_order %}Series position: {{book.series_order}}{% endif %}
{% if book.overview %}Overview: {{book.overview}}{% endif %}
{% if book.genre %}Genre: {{book.genre}}{% endif %}
{% if book.style %}Style guidance: {{book.style}}{% endif %}
{% if book.pov %}Default POV: {{book.pov}}{% endif %}
{% if book.tense %}Default tense: {{book.tense}}{% endif %}
{% if book.language %}Language: {{book.language}}{% endif %}`,
    },
    {
      id: 'chat-book-context', name: 'Book context', role: 'system', enabled: true,
      template: `{% if context.automatic %}# Automatic context
{{context.automatic}}{% endif %}

{% if context.additional %}# Additional context
{{context.additional}}{% endif %}`,
    },
  ],
}
