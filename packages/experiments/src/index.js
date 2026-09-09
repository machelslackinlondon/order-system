export class UnknownExperimentError extends Error {
  constructor(experiment, available) {
    super(`Unknown experiment: ${experiment}`);
    this.name = 'UnknownExperimentError';
    this.code = 'UNKNOWN_EXPERIMENT';
    this.experiment = experiment;
    this.available = available;
  }
}

export function createExperimentRunner({ experiments, write }) {
  return {
    async run(name) {
      const experiment = experiments.get(name);
      if (!experiment) {
        throw new UnknownExperimentError(name, [...experiments.keys()].sort());
      }

      await write(`Experiment: ${experiment.title}`);
      await write(`Demonstrates: ${experiment.demonstrates}`);

      const result = await experiment.run();
      for (const observation of result.observations) {
        await write(observation);
      }

      await write(`Result: ${result.conclusion}`);
      await write(`Source: ${experiment.source}`);
      await write(`Commits: ${experiment.commits.join(', ')}`);

      return { name, status: 'COMPLETED' };
    },
  };
}
