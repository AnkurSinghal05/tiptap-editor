const randomSuffix = () => Math.random().toString(36).slice(2, 10);

export const generateSectionId = () => `section-${randomSuffix()}`;

export const generateClauseId = () => `clause-${randomSuffix()}`;
