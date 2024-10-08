<script lang="ts">
import { defineComponent } from 'vue';
import ResourcesListLayout, { type IResource } from '@/components/layouts/ResourcesListLayout.vue';
import WorkflowCard from '@/components/WorkflowCard.vue';
import WorkflowTagsDropdown from '@/components/WorkflowTagsDropdown.vue';
import { EnterpriseEditionFeature, MORE_ONBOARDING_OPTIONS_EXPERIMENT, VIEWS } from '@/constants';
import type { ITag, IUser, IWorkflowDb } from '@/Interface';
import { mapStores } from 'pinia';
import { useUIStore } from '@/stores/ui.store';
import { useSettingsStore } from '@/stores/settings.store';
import { useUsersStore } from '@/stores/users.store';
import { useWorkflowsStore } from '@/stores/workflows.store';
import { useSourceControlStore } from '@/stores/sourceControl.store';
import { useTagsStore } from '@/stores/tags.store';
import { useProjectsStore } from '@/stores/projects.store';
import ProjectTabs from '@/components/Projects/ProjectTabs.vue';
import { useTemplatesStore } from '@/stores/templates.store';
import { getResourcePermissions } from '@/permissions';
import { usePostHog } from '@/stores/posthog.store';
import { useDocumentTitle } from '@/composables/useDocumentTitle';

interface Filters {
	search: string;
	homeProject: string;
	status: string | boolean;
	tags: string[];
}

const StatusFilter = {
	ACTIVE: true,
	DEACTIVATED: false,
	ALL: '',
};

const WorkflowsView = defineComponent({
	name: 'WorkflowsView',
	components: {
		ResourcesListLayout,
		WorkflowCard,
		WorkflowTagsDropdown,
		ProjectTabs,
	},
	data() {
		return {
			filters: {
				search: '',
				homeProject: '',
				status: StatusFilter.ALL,
				tags: [],
			} as Filters,
			sourceControlStoreUnsubscribe: () => {},
			loading: false,
			documentTitle: useDocumentTitle(),
		};
	},
	computed: {
		...mapStores(
			useSettingsStore,
			useUIStore,
			useUsersStore,
			useWorkflowsStore,
			useSourceControlStore,
			useTagsStore,
			useProjectsStore,
			useTemplatesStore,
			usePostHog,
		),
		readOnlyEnv(): boolean {
			return this.sourceControlStore.preferences.branchReadOnly;
		},
		currentUser(): IUser {
			return this.usersStore.currentUser || ({} as IUser);
		},
		allWorkflows(): IResource[] {
			return this.workflowsStore.allWorkflows as IResource[];
		},
		isShareable(): boolean {
			return this.settingsStore.isEnterpriseFeatureEnabled[EnterpriseEditionFeature.Sharing];
		},
		statusFilterOptions(): Array<{ label: string; value: string | boolean }> {
			return [
				{
					label: this.$locale.baseText('workflows.filters.status.all'),
					value: StatusFilter.ALL,
				},
				{
					label: this.$locale.baseText('workflows.filters.status.active'),
					value: StatusFilter.ACTIVE,
				},
				{
					label: this.$locale.baseText('workflows.filters.status.deactivated'),
					value: StatusFilter.DEACTIVATED,
				},
			];
		},
		userRole() {
			const role = this.usersStore.currentUserCloudInfo?.role;

			if (role) {
				return role;
			}

			const answers = this.usersStore.currentUser?.personalizationAnswers;
			if (answers && 'role' in answers) {
				return answers.role;
			}

			return undefined;
		},
		isOnboardingExperimentEnabled() {
			return (
				this.posthogStore.getVariant(MORE_ONBOARDING_OPTIONS_EXPERIMENT.name) ===
				MORE_ONBOARDING_OPTIONS_EXPERIMENT.variant
			);
		},
		isSalesUser() {
			if (!this.userRole) {
				return false;
			}
			return ['Sales', 'sales-and-marketing'].includes(this.userRole);
		},
		addWorkflowButtonText() {
			return this.projectsStore.currentProject
				? this.$locale.baseText('workflows.project.add')
				: this.$locale.baseText('workflows.add');
		},
		projectPermissions() {
			return getResourcePermissions(
				this.projectsStore.currentProject?.scopes ?? this.projectsStore.personalProject?.scopes,
			);
		},
		emptyListDescription() {
			if (this.readOnlyEnv) {
				return this.$locale.baseText('workflows.empty.description.readOnlyEnv');
			} else if (!this.projectPermissions.workflow.create) {
				return this.$locale.baseText('workflows.empty.description.noPermission');
			} else {
				return this.$locale.baseText('workflows.empty.description');
			}
		},
	},
	watch: {
		filters: {
			deep: true,
			handler() {
				this.saveFiltersOnQueryString();
			},
		},
		'$route.params.projectId'() {
			void this.initialize();
		},
	},
	async mounted() {
		this.documentTitle.set(this.$locale.baseText('workflows.heading'));
		await this.setFiltersFromQueryString();

		void this.usersStore.showPersonalizationSurvey();

		this.sourceControlStoreUnsubscribe = this.sourceControlStore.$onAction(({ name, after }) => {
			if (name === 'pullWorkfolder' && after) {
				after(() => {
					void this.initialize();
				});
			}
		});
	},
	beforeUnmount() {
		this.sourceControlStoreUnsubscribe();
	},
	methods: {
		onFiltersUpdated(filters: Filters) {
			this.filters = filters;
		},
		addWorkflow() {
			this.uiStore.nodeViewInitialized = false;
			void this.$router.push({
				name: VIEWS.NEW_WORKFLOW,
				query: { projectId: this.$route?.params?.projectId },
			});

			this.$telemetry.track('User clicked add workflow button', {
				source: 'Workflows list',
			});
			this.trackEmptyCardClick('blank');
		},
		getTemplateRepositoryURL() {
			return this.templatesStore.websiteTemplateRepositoryURL;
		},
		trackEmptyCardClick(option: 'blank' | 'templates' | 'courses') {
			this.$telemetry.track('User clicked empty page option', {
				option,
			});
			if (option === 'templates' && this.isSalesUser) {
				this.trackCategoryLinkClick('Sales');
			}
		},
		trackCategoryLinkClick(category: string) {
			this.$telemetry.track(`User clicked Browse ${category} Templates`, {
				role: this.usersStore.currentUserCloudInfo?.role,
				active_workflow_count: this.workflowsStore.activeWorkflows.length,
			});
		},
		async initialize() {
			this.loading = true;
			await Promise.all([
				this.usersStore.fetchUsers(),
				this.workflowsStore.fetchAllWorkflows(this.$route?.params?.projectId as string | undefined),
				this.workflowsStore.fetchActiveWorkflows(),
			]);
			this.loading = false;
		},
		onClickTag(tagId: string) {
			if (!this.filters.tags.includes(tagId)) {
				this.filters.tags.push(tagId);
			}
		},
		onFilter(
			resource: IWorkflowDb,
			filters: { tags: string[]; search: string; status: string | boolean },
			matches: boolean,
		): boolean {
			if (this.settingsStore.areTagsEnabled && filters.tags.length > 0) {
				matches =
					matches &&
					filters.tags.every((tag) =>
						(resource.tags as ITag[])?.find((resourceTag) =>
							typeof resourceTag === 'object'
								? `${resourceTag.id}` === `${tag}`
								: `${resourceTag}` === `${tag}`,
						),
					);
			}

			if (filters.status !== '') {
				matches = matches && resource.active === filters.status;
			}

			return matches;
		},
		saveFiltersOnQueryString() {
			const query: { [key: string]: string } = {};

			if (this.filters.search) {
				query.search = this.filters.search;
			}

			if (typeof this.filters.status !== 'string') {
				query.status = this.filters.status.toString();
			}

			if (this.filters.tags.length) {
				query.tags = this.filters.tags.join(',');
			}

			if (this.filters.homeProject) {
				query.homeProject = this.filters.homeProject;
			}

			void this.$router.replace({
				query: Object.keys(query).length ? query : undefined,
			});
		},
		isValidProjectId(projectId: string) {
			return this.projectsStore.availableProjects.some((project) => project.id === projectId);
		},
		async setFiltersFromQueryString() {
			const { tags, status, search, homeProject } = this.$route.query;

			const filtersToApply: { [key: string]: string | string[] | boolean } = {};

			if (homeProject && typeof homeProject === 'string') {
				await this.projectsStore.getAvailableProjects();
				if (this.isValidProjectId(homeProject)) {
					filtersToApply.homeProject = homeProject;
				}
			}

			if (search && typeof search === 'string') {
				filtersToApply.search = search;
			}

			if (tags && typeof tags === 'string') {
				const currentTags = this.tagsStore.allTags.map((tag) => tag.id);
				const savedTags = tags.split(',').filter((tag) => currentTags.includes(tag));
				if (savedTags.length) {
					filtersToApply.tags = savedTags;
				}
			}

			if (
				status &&
				typeof status === 'string' &&
				[StatusFilter.ACTIVE.toString(), StatusFilter.DEACTIVATED.toString()].includes(status)
			) {
				filtersToApply.status = status === 'true';
			}

			if (Object.keys(filtersToApply).length) {
				this.filters = {
					...this.filters,
					...filtersToApply,
				};
			}
		},
	},
});

export default WorkflowsView;
</script>

<template>
	<ResourcesListLayout
		ref="layout"
		resource-key="workflows"
		:resources="allWorkflows"
		:filters="filters"
		:additional-filters-handler="onFilter"
		:type-props="{ itemSize: 80 }"
		:shareable="isShareable"
		:initialize="initialize"
		:disabled="readOnlyEnv || !projectPermissions.workflow.create"
		:loading="loading"
		@click:add="addWorkflow"
		@update:filters="onFiltersUpdated"
	>
		<template #header>
			<ProjectTabs />
		</template>
		<template #add-button="{ disabled }">
			<n8n-tooltip :disabled="!readOnlyEnv">
				<div>
					<n8n-button
						size="large"
						block
						:disabled="disabled"
						data-test-id="resources-list-add"
						@click="addWorkflow"
					>
						{{ addWorkflowButtonText }}
					</n8n-button>
				</div>
				<template #content>
					<i18n-t tag="span" keypath="mainSidebar.workflows.readOnlyEnv.tooltip">
						<template #link>
							<a target="_blank" href="https://docs.n8n.io/source-control-environments/">
								{{ $locale.baseText('mainSidebar.workflows.readOnlyEnv.tooltip.link') }}
							</a>
						</template>
					</i18n-t>
				</template>
			</n8n-tooltip>
		</template>
		<template #default="{ data, updateItemSize }">
			<WorkflowCard
				data-test-id="resources-list-item"
				class="mb-2xs"
				:data="data"
				:read-only="readOnlyEnv"
				@expand:tags="updateItemSize(data)"
				@click:tag="onClickTag"
			/>
		</template>
		<template #empty>
			<div class="text-center mt-s">
				<n8n-heading tag="h2" size="xlarge" class="mb-2xs">
					{{
						currentUser.firstName
							? $locale.baseText('workflows.empty.heading', {
									interpolate: { name: currentUser.firstName },
								})
							: $locale.baseText('workflows.empty.heading.userNotSetup')
					}}
				</n8n-heading>
				<n8n-text v-if="!isOnboardingExperimentEnabled" size="large" color="text-base">
					{{ emptyListDescription }}
				</n8n-text>
			</div>
			<div
				v-if="!readOnlyEnv && projectPermissions.workflow.create"
				:class="['text-center', 'mt-2xl', $style.actionsContainer]"
			>
				<n8n-card
					:class="$style.emptyStateCard"
					hoverable
					data-test-id="new-workflow-card"
					@click="addWorkflow"
				>
					<n8n-icon :class="$style.emptyStateCardIcon" icon="file" />
					<n8n-text size="large" class="mt-xs" color="text-dark">
						{{ $locale.baseText('workflows.empty.startFromScratch') }}
					</n8n-text>
				</n8n-card>
				<a
					v-if="isSalesUser || isOnboardingExperimentEnabled"
					href="https://docs.n8n.io/courses/#available-courses"
					:class="$style.emptyStateCard"
					target="_blank"
				>
					<n8n-card
						hoverable
						data-test-id="browse-sales-templates-card"
						@click="trackEmptyCardClick('courses')"
					>
						<n8n-icon :class="$style.emptyStateCardIcon" icon="graduation-cap" />
						<n8n-text size="large" class="mt-xs" color="text-dark">
							{{ $locale.baseText('workflows.empty.learnN8n') }}
						</n8n-text>
					</n8n-card>
				</a>
				<a
					v-if="isSalesUser || isOnboardingExperimentEnabled"
					:href="getTemplateRepositoryURL()"
					:class="$style.emptyStateCard"
					target="_blank"
				>
					<n8n-card
						hoverable
						data-test-id="browse-sales-templates-card"
						@click="trackEmptyCardClick('templates')"
					>
						<n8n-icon :class="$style.emptyStateCardIcon" icon="box-open" />
						<n8n-text size="large" class="mt-xs" color="text-dark">
							{{ $locale.baseText('workflows.empty.browseTemplates') }}
						</n8n-text>
					</n8n-card>
				</a>
			</div>
		</template>
		<template #filters="{ setKeyValue }">
			<div v-if="settingsStore.areTagsEnabled" class="mb-s">
				<n8n-input-label
					:label="$locale.baseText('workflows.filters.tags')"
					:bold="false"
					size="small"
					color="text-base"
					class="mb-3xs"
				/>
				<WorkflowTagsDropdown
					:placeholder="$locale.baseText('workflowOpen.filterWorkflows')"
					:model-value="filters.tags"
					:create-enabled="false"
					@update:model-value="setKeyValue('tags', $event)"
				/>
			</div>
			<div class="mb-s">
				<n8n-input-label
					:label="$locale.baseText('workflows.filters.status')"
					:bold="false"
					size="small"
					color="text-base"
					class="mb-3xs"
				/>
				<n8n-select
					data-test-id="status-dropdown"
					:model-value="filters.status"
					@update:model-value="setKeyValue('status', $event)"
				>
					<n8n-option
						v-for="option in statusFilterOptions"
						:key="option.label"
						:label="option.label"
						:value="option.value"
						data-test-id="status"
					>
					</n8n-option>
				</n8n-select>
			</div>
		</template>
	</ResourcesListLayout>
</template>

<style lang="scss" module>
.actionsContainer {
	display: flex;
	justify-content: center;
}

.emptyStateCard {
	width: 192px;
	text-align: center;
	display: inline-flex;
	height: 230px;

	& + & {
		margin-left: var(--spacing-s);
	}

	&:hover {
		svg {
			color: var(--color-primary);
		}
	}
}

.emptyStateCardIcon {
	font-size: 48px;

	svg {
		width: 48px !important;
		color: var(--color-foreground-dark);
		transition: color 0.3s ease;
	}
}
</style>
