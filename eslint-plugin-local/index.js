/**
 * Local ESLint plugin for project-specific rules
 */
export default {
  rules: {
    'no-double-assert': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow chained type assertions (e.g., `as unknown as T`)',
          category: 'TypeScript',
          recommended: true
        },
        messages: {
          double: 'Avoid double type assertions (e.g. `as unknown as T`). Use proper type guards or validation instead.'
        },
        schema: []
      },
      create(context) {
        return {
          TSAsExpression(node) {
            // Check if the expression being asserted is itself a TSAsExpression
            if (node.expression && node.expression.type === 'TSAsExpression') {
              context.report({
                node,
                messageId: 'double'
              });
            }
          }
        };
      }
    }
  }
};
