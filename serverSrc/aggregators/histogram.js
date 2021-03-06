/* @flow */

import { getLabelPermutations, flattenLabels } from './util';
import type { HistogramMetric, HistogramEvent, Label } from './util';


type HistogramObservationAggregate = {
    buckets: {[bucketLimit: string]: number}, // Note, "+Inf" won't be kept in here. We'll just report `sum` as +Inf synthetically when printing this aggregate.
    sum: number,
    count: number
};

function addObservation(aggregate: HistogramObservationAggregate, newObservation: number) {
    Object.keys(aggregate.buckets).forEach((bucketLimit) => {
        if (newObservation <= Number(bucketLimit)) {
            aggregate.buckets[bucketLimit]++;
        }
    });

    aggregate.count++;
    aggregate.sum += newObservation;
}

function printObservationAggregate(metricName: string, labelPermutationKey: string, aggregate: HistogramObservationAggregate) {
    const leKeys = Object.keys(aggregate.buckets).sort((a, b) => Number(a) < Number(b) ? -1 : 1);
    const labelStringPrefix = labelPermutationKey.length > 0
        ? `${labelPermutationKey},` // stick labels in front of new `le` label with a comma
        : '';                       // no labels, no comma.

    const bucketLines = leKeys.map((bucketLimit) => {
        return `${metricName}_bucket{${labelStringPrefix}le="${bucketLimit}"} ${aggregate.buckets[bucketLimit]}`;
    });

    return bucketLines.join('\n') + '\n' +
    `${metricName}_bucket{${labelStringPrefix}le="+Inf"} ${aggregate.count}` + '\n' + 
    `${metricName}_sum{${labelPermutationKey}} ${aggregate.sum}` + '\n' +
    `${metricName}_count{${labelPermutationKey}} ${aggregate.count}`;
}

export type Histogram = {
    record: (event: HistogramEvent) => void,
    report: () => string
};

export function makeHistogram(config: HistogramMetric): Histogram {
    const { name, help, type } = config;

    const allowedLabelPermutations = getLabelPermutations(config.labels);

    const mapOfAggregates: {[key: string]: HistogramObservationAggregate} = {};

    allowedLabelPermutations.forEach((permutation) => {
        // initialize all allowed permutations to a bunch of empty buckets.
        const initializedAggregate:HistogramObservationAggregate = {
            buckets: {},
            sum: 0,
            count: 0,
        }

        config.buckets.forEach((bucketLimit) => {
            initializedAggregate.buckets[bucketLimit.toString()] = 0;
        });

        mapOfAggregates[permutation] = initializedAggregate;

        // later, all other permutations will be rejected, so this 
        // secures the counters against misbehaving clients who would
        // send unknown labels or values and crash poor prometheus.
    });

    return {
        record(event: HistogramEvent) {
            const labelPermutationKey = flattenLabels(event.labels);
            if (mapOfAggregates[labelPermutationKey]) {
                event.observations.forEach((observation) => {
                    addObservation(mapOfAggregates[labelPermutationKey], observation);
                });
                
            } else {
                console.log(`Disallowed label permutation ${labelPermutationKey}`);
            }
        },

        report() {
            let headerLines = [
                `# HELP ${name} ${help}`,
                `# TYPE ${name} ${type}`
            ];

            let bodyLines = Object.keys(mapOfAggregates).map((labelPermutationKey) => {
                const aggregate = mapOfAggregates[labelPermutationKey];
                return printObservationAggregate(name, labelPermutationKey, aggregate);
            });

            return headerLines.join('\n') + '\n' + bodyLines.join('\n');
        }
    }
}