import type { GitLabClient } from '../gitlabClient';
import type { Tool } from './tool';

export function graphqlQueryTools(client: GitLabClient): Tool[] {
  return [
    {
      name: 'graphql_project_details',
      description:
        'Get detailed project info via GraphQL, including description, visibility, star count, fork count, last activity, and open issues/MR counts.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          full_path: {
            type: 'string',
            description: 'Full project path, e.g. "mygroup/myproject"',
          },
        },
        required: ['full_path'],
      }),
      async execute(args) {
        const query = `query($path: ID!) {
          project(fullPath: $path) {
            name
            description
            visibility
            httpUrlToRepo
            starCount
            forksCount
            lastActivityAt
            createdAt
            webUrl
            openIssuesCount
            openMergeRequestsCount: mergeRequests(state: opened) { count }
            languages { name percentage }
            repository { rootRef }
          }
        }`;
        const data = await client.graphql(query, { path: args.full_path as string });
        return JSON.stringify(data, null, 2);
      },
    },
    {
      name: 'graphql_current_user',
      description:
        'Get detailed info about the current authenticated user via GraphQL, including groups, namespace, and recent activity.',
      parametersSchema: () => ({
        type: 'object',
        properties: {},
        required: [],
      }),
      async execute() {
        const query = `query {
          currentUser {
            id
            username
            name
            email
            avatarUrl
            webUrl
            bot
            groupCount
            projectMemberships(first: 10) {
              nodes {
                project { name fullPath webUrl }
                accessLevel { stringValue }
              }
            }
            namespace { path fullPath }
          }
        }`;
        const data = await client.graphql(query);
        return JSON.stringify(data, null, 2);
      },
    },
    {
      name: 'graphql_group_info',
      description:
        'Get detailed information about a GitLab group via GraphQL, including subgroups and projects.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          full_path: {
            type: 'string',
            description: 'Full group path, e.g. "mygroup" or "mygroup/subgroup"',
          },
        },
        required: ['full_path'],
      }),
      async execute(args) {
        const query = `query($path: ID!) {
          group(fullPath: $path) {
            id
            name
            fullPath
            description
            visibility
            webUrl
            projectsCount: projects { count }
            subgroupsCount: descendantGroups { count }
            milestones(state: active) { count }
          }
        }`;
        const data = await client.graphql(query, { path: args.full_path as string });
        return JSON.stringify(data, null, 2);
      },
    },
    {
      name: 'graphql_merge_request_details',
      description:
        'Get rich merge request details via GraphQL including approvals, reviewers, discussions, pipeline status, and diff stats.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_path: { type: 'string', description: 'Full project path' },
          iid: { type: 'string', description: 'Merge request IID' },
        },
        required: ['project_path', 'iid'],
      }),
      async execute(args) {
        const query = `query($path: ID!, $iid: String!) {
          project(fullPath: $path) {
            mergeRequest(iid: $iid) {
              title
              description
              state
              webUrl
              createdAt
              mergedAt
              sourceBranch
              targetBranch
              diffStatsSummary { additions deletions fileCount }
              approvedBy { nodes { username } }
              reviewers { nodes { username } }
              assignees { nodes { username } }
              labels { nodes { title color } }
              headPipeline { status detailedStatus { label } }
              discussions { count }
              userNotesCount
              conflicts
              mergeable
            }
          }
        }`;
        const data = await client.graphql(query, {
          path: args.project_path as string,
          iid: String(args.iid),
        });
        return JSON.stringify(data, null, 2);
      },
    },
    {
      name: 'graphql_issue_details',
      description:
        'Get rich issue details via GraphQL including linked MRs, time tracking, weight, related issues, and discussions.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_path: { type: 'string', description: 'Full project path' },
          iid: { type: 'string', description: 'Issue IID' },
        },
        required: ['project_path', 'iid'],
      }),
      async execute(args) {
        const query = `query($path: ID!, $iid: String!) {
          project(fullPath: $path) {
            issue(iid: $iid) {
              title
              description
              state
              webUrl
              createdAt
              closedAt
              dueDate
              weight
              confidential
              assignees { nodes { username } }
              labels { nodes { title color } }
              milestone { title dueDate }
              userNotesCount
              relatedMergeRequests { count }
              timeEstimate
              totalTimeSpent
            }
          }
        }`;
        const data = await client.graphql(query, {
          path: args.project_path as string,
          iid: String(args.iid),
        });
        return JSON.stringify(data, null, 2);
      },
    },
    {
      name: 'graphql_pipeline_details',
      description:
        'Get detailed pipeline info via GraphQL including jobs, stages, and test reports.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_path: { type: 'string', description: 'Full project path' },
          iid: { type: 'string', description: 'Pipeline IID' },
        },
        required: ['project_path', 'iid'],
      }),
      async execute(args) {
        const query = `query($path: ID!, $iid: ID!) {
          project(fullPath: $path) {
            pipeline(iid: $iid) {
              id
              iid
              status
              createdAt
              finishedAt
              duration
              queuedDuration
              ref
              sha
              source
              stages {
                nodes {
                  name
                  status
                  jobs {
                    nodes {
                      name
                      status
                      duration
                      queuedDuration
                      finishedAt
                      allowFailure
                    }
                  }
                }
              }
              testReportSummary {
                total { count success failed skipped error }
              }
            }
          }
        }`;
        const data = await client.graphql(query, {
          path: args.project_path as string,
          iid: String(args.iid),
        });
        return JSON.stringify(data, null, 2);
      },
    },
    {
      name: 'graphql_vulnerability_report',
      description:
        'Get vulnerability findings for a project via GraphQL. Requires Ultimate tier.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_path: { type: 'string', description: 'Full project path' },
          severity: {
            type: 'string',
            enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO', 'UNKNOWN'],
            description: 'Filter by severity (optional)',
          },
          first: { type: 'integer', default: 20 },
        },
        required: ['project_path'],
      }),
      async execute(args) {
        const first = Math.min(Math.max(1, Math.trunc(Number(args.first) || 20)), 100);
        const severityFilter = args.severity ? ', severity: [$severity]' : '';
        const query = `query($path: ID!, $first: Int!${args.severity ? ', $severity: VulnerabilitySeverity!' : ''}) {
          project(fullPath: $path) {
            vulnerabilities(first: $first${severityFilter}) {
              nodes {
                title
                severity
                state
                reportType
                detectedAt
                resolvedAt
                location { ... on VulnerabilityLocationSast { file startLine } }
              }
            }
          }
        }`;
        const variables: Record<string, unknown> = { path: args.project_path as string, first };
        if (args.severity) {
          const allowed = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO', 'UNKNOWN'];
          const sev = String(args.severity).toUpperCase();
          if (!allowed.includes(sev)) {
            return JSON.stringify({ error: `Invalid severity: ${sev}. Must be one of: ${allowed.join(', ')}` });
          }
          variables.severity = sev;
        }
        const data = await client.graphql(query, variables);
        return JSON.stringify(data, null, 2);
      },
    },
    {
      name: 'graphql_environments',
      description: 'List environments for a project via GraphQL with deployment status.',
      parametersSchema: () => ({
        type: 'object',
        properties: {
          project_path: { type: 'string', description: 'Full project path' },
        },
        required: ['project_path'],
      }),
      async execute(args) {
        const query = `query($path: ID!) {
          project(fullPath: $path) {
            environments {
              nodes {
                name
                state
                environmentType
                externalUrl
                lastDeployment {
                  status
                  createdAt
                  finishedAt
                  ref
                  sha
                  iid
                }
              }
            }
          }
        }`;
        const data = await client.graphql(query, { path: args.project_path as string });
        return JSON.stringify(data, null, 2);
      },
    },
  ];
}
