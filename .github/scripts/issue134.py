from pathlib import Path

path = Path('src/ChatFeature.tsx')
source = path.read_text()

history_import = "import { chatHistoryPrefixMatches } from './chat-history-guard'\n"
owner_import = """import {\n  abortAllChatGenerations,\n  abortChatGeneration,\n  abortChatGenerationsOutsideSelection,\n  createChatGenerationOwner,\n  getChatGenerationOwner,\n  ownsChatGeneration,\n  registerChatGeneration,\n  releaseChatGeneration,\n  setChatGenerationPhase,\n  type ChatGenerationOwner,\n  type ChatGenerationOwners,\n} from './chat-generation-owner'\nimport { runChatSendPipeline } from './chat-send-pipeline'\n"""
if owner_import not in source:
    if history_import not in source:
        raise SystemExit('Chat history import anchor not found')
    source = source.replace(history_import, history_import + owner_import, 1)

old_ref = "  const abortRef = useRef<AbortController | null>(null)\n"
new_ref = "  const generationOwnersRef = useRef<ChatGenerationOwners>(new Map())\n"
if new_ref not in source:
    if old_ref not in source:
        raise SystemExit('abortRef anchor not found')
    source = source.replace(old_ref, new_ref, 1)

old_abort = "    abortRef.current?.abort()\n"
selection_abort = "    abortChatGenerationsOutsideSelection(generationOwnersRef.current, bookId, chatId)\n"
if selection_abort not in source:
    if old_abort not in source:
        raise SystemExit('selection abort anchor not found')
    source = source.replace(old_abort, selection_abort, 1)

cleanup_abort = "    abortAllChatGenerations(generationOwnersRef.current)\n"
if cleanup_abort not in source:
    if old_abort not in source:
        raise SystemExit('cleanup abort anchor not found')
    source = source.replace(old_abort, cleanup_abort, 1)

start = source.find('  async function runAssistantGeneration(activeChat: ChatEntity, history: ChatMessageEntity[]) {')
end = source.find('  async function deleteFrom(message: ChatMessageEntity) {', start)
if start < 0 or end <= start:
    raise SystemExit('Chat generation/send block anchors not found')

replacement = r'''  type ChatRequestHistoryItem = Pick<ChatMessageEntity, 'role' | 'content' | 'thoughts' | 'documentEdits' | 'codexCreations' | 'outlineActions' | 'entityActions'>
  type PreparedAssistantGeneration = {
    settings: Awaited<ReturnType<typeof getChatBookAiSettings>>
    context: Awaited<ReturnType<typeof buildContextValues>>
  }

  function generationOwnsCurrentUi(owner: ChatGenerationOwner) {
    return ownsChatGeneration(generationOwnersRef.current, owner)
      && selectedBookIdRef.current === owner.bookId
      && selectedChatIdRef.current === owner.chatId
  }

  function setOwnedGenerationPhase(owner: ChatGenerationOwner, nextPhase: GenerationPhase) {
    if (!setChatGenerationPhase(generationOwnersRef.current, owner, nextPhase)) return false
    if (generationOwnsCurrentUi(owner)) setPhase(nextPhase)
    return true
  }

  function beginGenerationUi(owner: ChatGenerationOwner) {
    if (!generationOwnsCurrentUi(owner)) return
    startedAtRef.current = Date.now()
    setElapsed(0)
    setGenerating(true)
    setEditingId('')
    setPhase('sending')
    setStreamedContent('')
    setStreamedThoughts('')
    setLiveThoughtsOpen(true)
    followOutputRef.current = true
    setFollowOutput(true)
  }

  function finishGenerationOwner(owner: ChatGenerationOwner) {
    const ownsUi = generationOwnsCurrentUi(owner)
    const released = releaseChatGeneration(generationOwnersRef.current, owner)
    if (!released || !ownsUi) return
    setGenerating(false)
    setPhase(null)
    setElapsed(0)
    setStreamedContent('')
    setStreamedThoughts('')
  }

  function reserveGeneration(activeChat: ChatEntity) {
    const owner = createChatGenerationOwner(activeChat.bookId, activeChat.id)
    if (!registerChatGeneration(generationOwnersRef.current, owner)) return null
    beginGenerationUi(owner)
    return owner
  }

  function assertGenerationOwnerCurrent(owner: ChatGenerationOwner, activeChat: ChatEntity) {
    if (!ownsChatGeneration(generationOwnersRef.current, owner) || owner.controller.signal.aborted || !isCurrentChat(activeChat)) {
      throw new DOMException('Chat generation was cancelled.', 'AbortError')
    }
  }

  function buildProviderMessages(
    activeChat: ChatEntity,
    history: ChatRequestHistoryItem[],
    prepared: PreparedAssistantGeneration,
  ) {
    const { settings, context } = prepared
    const promptValues = { ...bookPromptValues, responseLength: settings.responseLength }
    const systemPrompt = renderPromptTemplate(activeChat.systemPrompt, bookTemplateValues(promptValues))
    const contextSections = [
      context.lastSceneText ? section(`Current scene${context.lastSceneTitle ? ` — ${context.lastSceneTitle}` : ''}`, context.lastSceneText) : '',
      context.additionalContext ? section('Additional context', context.additionalContext) : '',
    ].filter(Boolean)
    const historyMessages = history.map((message): ChatCompletionMessage => {
      const editState = message.role === 'assistant' && message.documentEdits?.length
        ? `\n\n[Workspace edit proposals: ${message.documentEdits.map((proposal) => `${proposal.entityTitle}: ${proposal.status}`).join('; ')}]`
        : ''
      const creationState = message.role === 'assistant' && message.codexCreations?.length
        ? `\n\n[Codex creation proposals: ${message.codexCreations.map((proposal) => `${proposal.title}: ${proposal.status}`).join('; ')}]`
        : ''
      const outlineState = message.role === 'assistant' && message.outlineActions?.length
        ? `\n\n[Outline proposals: ${message.outlineActions.map((proposal) => `${proposal.action} ${proposal.entityTitle}: ${proposal.status}`).join('; ')}]`
        : ''
      const entityActionState = message.role === 'assistant' && message.entityActions?.length
        ? `\n\n[Entity proposals: ${message.entityActions.map((proposal) => `${proposal.action} ${proposal.entityTitle}: ${proposal.status}`).join('; ')}]`
        : ''
      return {
        role: message.role,
        content: `${message.content}${editState}${creationState}${outlineState}${entityActionState}`,
        ...(message.role === 'assistant' && message.thoughts ? { reasoning_content: message.thoughts } : {}),
      }
    })
    const lengthMessage = responseLengthMessage(activeChat.systemPrompt, settings.responseLength)
    let latestUserIndex = -1
    history.forEach((message, index) => { if (message.role === 'user') latestUserIndex = index })
    if (lengthMessage && latestUserIndex >= 0) historyMessages.splice(latestUserIndex, 0, { role: 'user', content: lengthMessage })
    return [
      { role: 'system' as const, content: systemPrompt },
      { role: 'system' as const, content: CHAT_WORKSPACE_INSTRUCTIONS },
      ...(contextSections.length ? [{ role: 'system' as const, content: `# Selected book context\n\n${contextSections.join('\n\n')}` }] : []),
      ...historyMessages,
    ] satisfies ChatCompletionMessage[]
  }

  async function prepareAssistantGeneration(
    activeChat: ChatEntity,
    history: ChatRequestHistoryItem[],
    owner: ChatGenerationOwner,
  ): Promise<PreparedAssistantGeneration> {
    assertGenerationOwnerCurrent(owner, activeChat)
    let settings: Awaited<ReturnType<typeof getChatBookAiSettings>>
    try {
      settings = await getChatBookAiSettings(activeChat.bookId)
    } catch {
      assertGenerationOwnerCurrent(owner, activeChat)
      throw new Error('This book’s AI settings could not be loaded.')
    }
    assertGenerationOwnerCurrent(owner, activeChat)
    if (!settings.apiKey.trim()) throw new Error('Add an API key in Book AI settings before chatting.')
    if (!activeChat.model.trim()) throw new Error('Choose a chat model before sending.')

    let context: Awaited<ReturnType<typeof buildContextValues>>
    try {
      context = await buildContextValues({
        bookId: activeChat.bookId,
        type: 'chat',
        currentSceneId: currentSceneId || undefined,
        profile: activeChat.contextProfile,
      })
    } catch (error) {
      assertGenerationOwnerCurrent(owner, activeChat)
      throw new Error(error instanceof Error ? error.message : 'Chat context could not be prepared.')
    }
    assertGenerationOwnerCurrent(owner, activeChat)

    const prepared = { settings, context }
    const providerMessages = buildProviderMessages(activeChat, history, prepared)
    const diagnostics = generationContextDiagnostics(activeChat.model, activeChat.modelContextLength, activeChat.effectiveContextLimit, serializeChatModelInput(providerMessages))
    if (!diagnostics.limitValid) throw new Error(diagnostics.limitError ?? 'The Chat context cap is invalid.')
    if (!diagnostics.fits) {
      throw new Error(`Context is too large: ~${diagnostics.requestTokens.toLocaleString()} input tokens for a ${diagnostics.usableInputTokens.toLocaleString()}-token usable Chat budget (${diagnostics.effectiveContextTokens.toLocaleString()} effective limit, ${diagnostics.responseReserveTokens.toLocaleString()} reserved for the response). Reduce Chat context, summarize older material, raise the cap, or choose a larger model.`)
    }
    if (diagnostics.warning) onToast(`Chat context is near the configured limit (${Math.round(diagnostics.usageRatio * 100)}%). Consider reducing selected context or raising the cap.`)
    assertGenerationOwnerCurrent(owner, activeChat)
    return prepared
  }

  async function runAssistantGeneration(
    activeChat: ChatEntity,
    history: ChatMessageEntity[],
    reservedOwner?: ChatGenerationOwner,
    preparedInputs?: PreparedAssistantGeneration,
  ) {
    const owner = reservedOwner ?? reserveGeneration(activeChat)
    if (!owner) {
      if (isCurrentChat(activeChat)) onToast('This Chat already has a generation finishing. Try again when it completes.')
      return
    }
    const controller = owner.controller
    const sourceBookId = activeChat.bookId
    let completed = false
    let unexpectedFailure = false
    let historyInvalidated = false
    let activeRoundContent = ''
    let activeRoundThoughts = ''
    let activeRoundExtras: Pick<ChatMessageEntity, 'documentEdits' | 'codexCreations' | 'outlineActions' | 'entityActions'> = {}
    let activeRoundPersisted = false
    let activeRoundStartedAt = Date.now()

    async function ensureSourceHistoryStillCurrent() {
      const durableHistory = await listChatMessages(sourceBookId, activeChat.id)
      if (chatHistoryPrefixMatches(history, durableHistory)) return
      historyInvalidated = true
      controller.abort()
      throw new Error('Chat history changed while this response was generating. The streamed reply was not saved.')
    }

    async function persistAssistantRound(
      roundContent: string,
      roundThoughts: string,
      extras: Pick<ChatMessageEntity, 'documentEdits' | 'codexCreations' | 'outlineActions' | 'entityActions'> = {},
      status: ChatMessageStatus = 'complete',
    ) {
      const hasWorkspaceProposal = Boolean(extras.documentEdits?.length || extras.codexCreations?.length || extras.outlineActions?.length || extras.entityActions?.length)
      if (roundContent || roundThoughts || hasWorkspaceProposal) await ensureSourceHistoryStillCurrent()
      if (!roundContent && !roundThoughts && !hasWorkspaceProposal) return null
      return createChatMessage(activeChat, 'assistant', roundContent, {
        thoughts: roundThoughts || undefined,
        status,
        documentEdits: extras.documentEdits,
        codexCreations: extras.codexCreations,
        outlineActions: extras.outlineActions,
        entityActions: extras.entityActions,
      })
    }

    function workspaceProposalIds(extras: Pick<ChatMessageEntity, 'documentEdits' | 'codexCreations' | 'outlineActions' | 'entityActions'>) {
      return [
        ...(extras.documentEdits ?? []).map((proposal) => `document:${proposal.id}`),
        ...(extras.codexCreations ?? []).map((proposal) => `codex:${proposal.id}`),
        ...(extras.outlineActions ?? []).map((proposal) => `outline:${proposal.id}`),
        ...(extras.entityActions ?? []).map((proposal) => `entity:${proposal.id}`),
      ].sort().join('|')
    }

    async function findAlreadyPersistedRound() {
      const expectedProposalIds = workspaceProposalIds(activeRoundExtras)
      const persisted = await listChatMessages(sourceBookId, activeChat.id)
      return [...persisted].reverse().find((message) => message.role === 'assistant'
        && message.createdAt >= activeRoundStartedAt
        && message.content === activeRoundContent
        && (message.thoughts ?? '') === activeRoundThoughts
        && workspaceProposalIds(message) === expectedProposalIds) ?? null
    }

    function commitVisibleRound(saved: ChatMessageEntity | null, hadThoughts: boolean) {
      if (!generationOwnsCurrentUi(owner)) return
      if (saved) {
        setMessages((current) => current.some((message) => message.id === saved.id) ? current : [...current, saved])
        if (hadThoughts && liveThoughtsOpen) {
          setOpenThoughtMessageIds((current) => {
            const next = new Set(current)
            next.add(saved.id)
            return next
          })
        }
      }
      setStreamedContent('')
      setStreamedThoughts('')
    }

    async function persistInterruptedRound(status: Exclude<ChatMessageStatus, 'complete'>) {
      if (activeRoundPersisted) return
      const existing = await findAlreadyPersistedRound()
      if (existing) {
        activeRoundPersisted = true
        const saved = existing.status === status ? existing : await updateChatMessage(existing.id, { status })
        commitVisibleRound(saved, Boolean(activeRoundThoughts))
        return
      }
      const saved = await persistAssistantRound(activeRoundContent, activeRoundThoughts, activeRoundExtras, status)
      activeRoundPersisted = Boolean(saved)
      commitVisibleRound(saved, Boolean(activeRoundThoughts))
    }

    try {
      const prepared = preparedInputs ?? await prepareAssistantGeneration(activeChat, history, owner)
      assertGenerationOwnerCurrent(owner, activeChat)
      const { settings } = prepared
      const providerMessages = buildProviderMessages(activeChat, history, prepared)
      const workingMessages = [...providerMessages]
      for (let round = 0; round < 8 && !controller.signal.aborted; round += 1) {
        const roundDiagnostics = generationContextDiagnostics(activeChat.model, activeChat.modelContextLength, activeChat.effectiveContextLimit, serializeChatModelInput(workingMessages))
        if (!roundDiagnostics.limitValid) throw new Error(roundDiagnostics.limitError ?? 'The Chat context cap is invalid.')
        if (!roundDiagnostics.fits) throw new Error(`Chat context exceeded its usable budget after workspace tool results (~${roundDiagnostics.requestTokens.toLocaleString()} / ${roundDiagnostics.usableInputTokens.toLocaleString()} input tokens). Reduce context or raise the cap; Arc will not remove older turns automatically.`)
        activeRoundContent = ''
        activeRoundThoughts = ''
        activeRoundExtras = {}
        activeRoundPersisted = false
        activeRoundStartedAt = Date.now()
        const result = await streamChatCompletion({
          apiKey: settings.apiKey.trim(),
          baseUrl: settings.baseUrl,
          provider: settings.provider,
          model: activeChat.model,
          messages: workingMessages,
          thinking: activeChat.thinking,
          tools: CHAT_TOOL_DEFINITIONS,
        }, (chunk) => {
          if (!generationOwnsCurrentUi(owner)) return
          if (chunk.thoughts) {
            activeRoundThoughts += chunk.thoughts
            setStreamedThoughts(activeRoundThoughts)
            if (!activeRoundContent) setOwnedGenerationPhase(owner, 'thinking')
          }
          if (chunk.content) {
            activeRoundContent += chunk.content
            setStreamedContent(activeRoundContent)
            setOwnedGenerationPhase(owner, 'writing')
          }
        }, controller.signal, () => {
          if (!controller.signal.aborted) setOwnedGenerationPhase(owner, 'thinking')
        })

        if (controller.signal.aborted || !ownsChatGeneration(generationOwnersRef.current, owner)) break
        if (result.toolCalls.length) {
          setOwnedGenerationPhase(owner, 'using-tools')
          workingMessages.push({
            role: 'assistant',
            content: activeRoundContent || null,
            ...(activeRoundThoughts ? { reasoning_content: activeRoundThoughts } : {}),
            tool_calls: result.toolCalls,
          })
          const roundProposals: ChatDocumentEditProposal[] = []
          const roundCodexCreations: ChatCodexCreationProposal[] = []
          const roundOutlineActions: ChatOutlineActionProposal[] = []
          const roundEntityActions: ChatEntityActionProposal[] = []
          for (const call of result.toolCalls) {
            if (chatOutlineToolNames.has(call.function.name)) {
              const execution = await executeChatOutlineTool(sourceBookId, call)
              if (execution.outlineAction) {
                roundOutlineActions.push(execution.outlineAction)
                activeRoundExtras.outlineActions = roundOutlineActions
              }
              workingMessages.push({ role: 'tool', tool_call_id: call.id, content: execution.content })
            } else if (chatEntityToolNames.has(call.function.name)) {
              const execution = await executeChatEntityTool(sourceBookId, call)
              if (execution.entityAction) {
                roundEntityActions.push(execution.entityAction)
                activeRoundExtras.entityActions = roundEntityActions
              }
              workingMessages.push({ role: 'tool', tool_call_id: call.id, content: execution.content })
            } else {
              const execution = await executeChatWorkspaceTool(sourceBookId, call)
              if (execution.proposal) {
                roundProposals.push(execution.proposal)
                activeRoundExtras.documentEdits = roundProposals
              }
              if (execution.codexCreation) {
                roundCodexCreations.push(execution.codexCreation)
                activeRoundExtras.codexCreations = roundCodexCreations
              }
              workingMessages.push({ role: 'tool', tool_call_id: call.id, content: execution.content })
            }
          }

          const saved = await persistAssistantRound(activeRoundContent, activeRoundThoughts, activeRoundExtras)
          activeRoundPersisted = Boolean(saved)
          commitVisibleRound(saved, Boolean(activeRoundThoughts))
          if (controller.signal.aborted) break
          setOwnedGenerationPhase(owner, 'thinking')
          continue
        }

        const saved = await persistAssistantRound(activeRoundContent, activeRoundThoughts)
        activeRoundPersisted = Boolean(saved)
        commitVisibleRound(saved, Boolean(activeRoundThoughts))
        if (saved?.content && settings.speech.readAloudAfterGeneration) {
          void startTtsSession(settings.speech, saved.content, `Chat · ${activeChat.title}`).catch((error) => onToast(error instanceof Error ? error.message : 'Automatic read aloud failed.'))
        }
        completed = true
        break
      }
      if (!completed && !controller.signal.aborted) throw new Error('The assistant used too many workspace tool steps. Ask it to make a smaller edit.')
    } catch (error) {
      const aborted = controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')
      if (historyInvalidated) {
        onToast(error instanceof Error ? error.message : 'Chat history changed while this response was generating. The streamed reply was not saved.')
      } else if (!aborted) {
        unexpectedFailure = true
        onToast(error instanceof Error ? error.message : 'Chat generation stopped unexpectedly.')
      }
    } finally {
      const stopped = controller.signal.aborted
      if (!historyInvalidated && !activeRoundPersisted && (stopped || unexpectedFailure)) {
        try {
          await persistInterruptedRound(stopped ? 'stopped' : 'failed')
        } catch {
          // Keep the already streamed partial visible until teardown even if persistence fails.
        }
      }
      finishGenerationOwner(owner)
      const refreshed = await getChat(activeChat.id).catch(() => undefined)
      if (refreshed?.bookId === sourceBookId) applyIfCurrentChat(activeChat, () => setChat(refreshed))
    }
  }

  async function send() {
    if (!chat || generating || !isCurrentChat(chat)) return
    const sourceChat = chat
    const text = draft.trim()
    if (!text) return

    const owner = createChatGenerationOwner(sourceChat.bookId, sourceChat.id)
    if (!registerChatGeneration(generationOwnersRef.current, owner)) {
      onToast('This Chat already has a generation finishing. Try again when it completes.')
      return
    }
    beginGenerationUi(owner)
    setDraft('')
    let persisted = false

    try {
      await runChatSendPipeline({
        preflight: async () => {
          const durableHistory = await listChatMessages(sourceChat.bookId, sourceChat.id)
          assertGenerationOwnerCurrent(owner, sourceChat)
          const previewHistory: ChatRequestHistoryItem[] = [...durableHistory, { role: 'user', content: text }]
          const prepared = await prepareAssistantGeneration(sourceChat, previewHistory, owner)
          return { durableHistory, prepared }
        },
        persist: async ({ durableHistory }) => {
          assertGenerationOwnerCurrent(owner, sourceChat)
          const userMessage = await createChatMessage(sourceChat, 'user', text)
          persisted = true
          const history = [...durableHistory, userMessage]
          if (generationOwnsCurrentUi(owner)) {
            setMessages(history)
            setChat(sourceChat)
          }
          return { history }
        },
        generate: async ({ prepared }, { history }) => {
          await runAssistantGeneration(sourceChat, history, owner, prepared)
        },
        onPostPersistError: (error) => {
          finishGenerationOwner(owner)
          if (!(error instanceof DOMException && error.name === 'AbortError')) {
            onToast(error instanceof Error ? error.message : 'Chat generation stopped unexpectedly.')
          }
        },
      })
    } catch (error) {
      finishGenerationOwner(owner)
      if (!persisted) applyIfCurrentChat(sourceChat, () => setDraft(text))
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        onToast(error instanceof Error ? error.message : 'Could not send the message.')
      }
    }
  }

  function stop() {
    const owner = getChatGenerationOwner(generationOwnersRef.current, selectedBookIdRef.current, selectedChatIdRef.current)
    if (!owner) return
    setOwnedGenerationPhase(owner, 'stopping')
    abortChatGeneration(generationOwnersRef.current, owner.bookId, owner.chatId)
  }

'''

source = source[:start] + replacement + source[end:]

if 'abortRef' in source:
    raise SystemExit('abortRef remains after Chat ownership patch')
if "runChatSendPipeline({" not in source:
    raise SystemExit('send pipeline was not installed')

path.write_text(source)
